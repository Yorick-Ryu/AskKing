import Foundation
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class AppState: ObservableObject {
    static let defaultRelayURLString = "https://askking.rick216.cn"

    @Published var relayURLString: String
    @Published var isPaired: Bool
    @Published var events: [EventItem] = []
    @Published var connectionStatus = "离线"
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
        relayURLString = UserDefaults.standard.string(forKey: "relayURL") ?? Self.defaultRelayURLString
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

    func prepareNetworkAccess() async {
        guard !isPaired else { return }
        await prepareInternetAccess()
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
            notice = "二维码不是 Codex Done 配对信息"
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

    func logout() async {
        stopPolling()
        let pairedAPI = api
        clearLocalPairing()

        Task {
            do {
                try await pairedAPI.unpairDevice()
            } catch {
                guard !isCancellationError(error) else { return }
                await MainActor.run {
                    notice = "已清除本地配对。远端注销失败：\(error.localizedDescription)"
                }
            }
        }
    }

    private func clearLocalPairing() {
        KeychainStore.delete("sessionToken")
        KeychainStore.delete("deviceId")
        isPaired = false
        events = []
        connectionStatus = "离线"
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
