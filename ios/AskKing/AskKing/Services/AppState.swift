import Foundation
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class AppState: ObservableObject {
    @Published var relayURLString: String
    @Published var isPaired: Bool
    @Published var events: [EventItem] = []
    @Published var connectionStatus = "离线"
    @Published var isDiscoveringRelay = false
    @Published var isTestingConnection = false
    @Published var notice: String?
    @Published var selectedRoute: EventRoute?
    @Published var selectedTab: AppTab = .messages
    @Published var notificationStatus: UNAuthorizationStatus = .notDetermined
    @Published var appearance: AppearanceMode {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: "appearance") }
    }

    private var pollingTask: Task<Void, Never>?

    init() {
        relayURLString = UserDefaults.standard.string(forKey: "relayURL") ?? "http://localhost:8787"
        isPaired = Self.sessionToken != nil
        appearance = AppearanceMode(rawValue: UserDefaults.standard.string(forKey: "appearance") ?? "system") ?? .system
    }

    var api: RelayAPI {
        RelayAPI(baseURL: URL(string: relayURLString)!, sessionToken: Self.sessionToken)
    }

    var appVersionText: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "-"
        return "\(version) (\(build))"
    }

    static var sessionToken: String? {
        KeychainStore.get("sessionToken")
    }

    static var deviceId: String? {
        KeychainStore.get("deviceId")
    }

    func saveRelayURL() {
        UserDefaults.standard.set(relayURLString, forKey: "relayURL")
    }

    func prepareLocalNetworkAccess() async {
        guard !isPaired else { return }
        _ = await RelayDiscovery.find(timeout: 1.5)
    }

    func prepareNetworkAccess() async {
        guard !isPaired else { return }
        async let localNetwork: Void = prepareLocalNetworkAccess()
        async let internetNetwork: Void = prepareInternetAccess()
        _ = await (localNetwork, internetNetwork)
    }

    private func prepareInternetAccess() async {
        guard let url = URL(string: "https://captive.apple.com/hotspot-detect.html") else { return }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2
        config.timeoutIntervalForResource = 2
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        _ = try? await session.data(from: url)
    }

    func pair(code: String) async {
        do {
            let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
            saveRelayURL()
            let response = try await api.pair(code: trimmedCode)
            KeychainStore.set(response.sessionToken, for: "sessionToken")
            KeychainStore.set(response.deviceId, for: "deviceId")
            isPaired = true
            await requestNotifications()
            await refreshEvents()
            startPolling()
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func pair(scannedValue: String) async {
        guard let payload = AskKingPairingPayload(rawValue: scannedValue) else {
            notice = "二维码不是 AskKing 配对信息"
            return
        }
        relayURLString = payload.relayURLString
        await pair(code: payload.code)
    }

    func requestNotifications() async {
        do {
            let center = UNUserNotificationCenter.current()
            NotificationActions.register()
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            await updateNotificationStatus()
            guard granted else { return }
            registerForRemoteNotificationsIfPaired()
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func updateNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationStatus = settings.authorizationStatus
    }

    var notificationStatusText: String {
        switch notificationStatus {
        case .authorized, .provisional, .ephemeral: "已允许"
        case .denied: "已拒绝"
        case .notDetermined: "未请求"
        @unknown default: "未知"
        }
    }

    var canRequestNotificationPermission: Bool {
        notificationStatus == .notDetermined
    }

    func syncRemoteNotificationsIfAllowed() async {
        await updateNotificationStatus()
        guard isPaired else { return }

        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral else {
            return
        }

        registerForRemoteNotificationsIfPaired()
    }

    private func registerForRemoteNotificationsIfPaired() {
        guard isPaired else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func registerDeviceToken(_ token: String) async {
        do {
            try await api.register(apnsToken: token)
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func openNotification(kind: String, id: String) {
        selectedTab = .messages
        selectedRoute = EventRoute(kind: kind, id: id)
        Task { await refreshEvents() }
    }

    func testConnection() async {
        guard !isTestingConnection else { return }
        isTestingConnection = true
        defer { isTestingConnection = false }

        do {
            saveRelayURL()
            connectionStatus = try await api.health() ? "在线" : "异常"
        } catch {
            guard !isCancellationError(error) else { return }
            connectionStatus = "离线"
        }
    }

    func discoverRelay() async {
        guard !isDiscoveringRelay else { return }
        isDiscoveringRelay = true
        connectionStatus = "正在查找 Relay"
        defer { isDiscoveringRelay = false }

        guard let relayURL = await Self.findRelay() else {
            connectionStatus = "未找到 Relay"
            notice = "没有在当前局域网发现 AskKing Relay"
            return
        }

        relayURLString = relayURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        saveRelayURL()
        connectionStatus = "在线"
        notice = "已发现 Relay：\(relayURLString)"
    }

    func refreshEvents() async {
        await refreshEvents(showsError: true)
    }

    func refreshEvents(showsError: Bool) async {
        guard isPaired else { return }
        do {
            events = try await api.events()
            connectionStatus = "在线"
        } catch {
            guard !isCancellationError(error) else { return }
            connectionStatus = "离线"
            if showsError {
                notice = error.localizedDescription
            }
        }
    }

    func startPolling() {
        guard isPaired, pollingTask == nil else { return }
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshEvents(showsError: false)
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    func decideApproval(id: String, decision: String) async {
        do {
            _ = try await api.decideApproval(id: id, decision: decision)
            await refreshEvents()
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func replyCompletion(id: String, reply: String) async {
        let trimmed = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            _ = try await api.replyCompletion(id: id, reply: trimmed)
            await refreshEvents()
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func handoffCompletionToComputer(id: String) async {
        do {
            _ = try await api.replyCompletion(id: id, reply: computerHandoffReply)
            await refreshEvents()
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func logout() async {
        stopPolling()
        do {
            try await api.unpairDevice()
            clearLocalPairing()
        } catch {
            guard !isCancellationError(error) else { return }
            startPolling()
            notice = error.localizedDescription
        }
    }

    private func clearLocalPairing() {
        KeychainStore.delete("sessionToken")
        KeychainStore.delete("deviceId")
        isPaired = false
        events = []
        connectionStatus = "离线"
    }

    private static func findRelay() async -> URL? {
        guard let url = await RelayDiscovery.find() else { return nil }
        return await isRelayHealthy(url) ? url : nil
    }

    private static func isRelayHealthy(_ baseURL: URL) async -> Bool {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2
        config.timeoutIntervalForResource = 2
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }

        do {
            let (_, response) = try await session.data(from: baseURL.appendingPathComponent("health"))
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }
}

func isCancellationError(_ error: Error) -> Bool {
    if error is CancellationError {
        return true
    }
    if let urlError = error as? URLError, urlError.code == .cancelled {
        return true
    }
    let nsError = error as NSError
    return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
}
