import Foundation
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class AppState: ObservableObject {
    @Published var relayURLString = UserDefaults.standard.string(forKey: "relayURL") ?? "http://localhost:8787"
    @Published var isPaired = KeychainStore.get("sessionToken") != nil
    @Published var events: [EventItem] = []
    @Published var connectionStatus = "未测试"
    @Published var isDiscoveringRelay = false
    @Published var notice: String?
    @Published var selectedRoute: EventRoute?
    @Published var selectedTab: AppTab = .messages
    @Published var notificationStatus = "未知"
    @Published var appearance: AppearanceMode = AppearanceMode(rawValue: UserDefaults.standard.string(forKey: "appearance") ?? "system") ?? .system {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: "appearance") }
    }

    private var pollingTask: Task<Void, Never>?
    private var shouldShowNextApnsSyncNotice = false

    var api: RelayAPI {
        RelayAPI(baseURL: URL(string: relayURLString)!, sessionToken: KeychainStore.get("sessionToken"))
    }

    var appVersionText: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "-"
        return "\(version) (\(build))"
    }

    func saveRelayURL() {
        UserDefaults.standard.set(relayURLString, forKey: "relayURL")
    }

    func pair(code: String) async {
        do {
            saveRelayURL()
            let response = try await api.pair(code: code)
            KeychainStore.set(response.sessionToken, for: "sessionToken")
            KeychainStore.set(response.deviceId, for: "deviceId")
            isPaired = true
            notice = "配对完成"
            await requestNotifications(showSyncNotice: false)
            await refreshEvents()
            startPolling()
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func requestNotifications(showSyncNotice: Bool = true) async {
        do {
            let center = UNUserNotificationCenter.current()
            NotificationActions.register()
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            await updateNotificationStatus()
            guard granted else { return }
            shouldShowNextApnsSyncNotice = showSyncNotice
            await MainActor.run {
                UIApplication.shared.registerForRemoteNotifications()
            }
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func updateNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationStatus = switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: "已允许"
        case .denied: "已拒绝"
        case .notDetermined: "未请求"
        @unknown default: "未知"
        }
    }

    func syncRemoteNotificationsIfAllowed() async {
        await updateNotificationStatus()
        guard isPaired else { return }

        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral else {
            return
        }

        shouldShowNextApnsSyncNotice = false
        UIApplication.shared.registerForRemoteNotifications()
    }

    func registerDeviceToken(_ token: String) async {
        do {
            let shouldShowNotice = shouldShowNextApnsSyncNotice
            shouldShowNextApnsSyncNotice = false
            try await api.register(apnsToken: token)
            if shouldShowNotice {
                notice = "APNs token 已同步"
            }
        } catch {
            guard !isCancellationError(error) else { return }
            shouldShowNextApnsSyncNotice = false
            notice = error.localizedDescription
        }
    }

    func openNotification(kind: String, id: String) {
        selectedTab = .messages
        selectedRoute = EventRoute(kind: kind, id: id)
        Task { await refreshEvents() }
    }

    func testConnection() async {
        do {
            saveRelayURL()
            connectionStatus = try await api.health() ? "在线" : "异常"
        } catch {
            guard !isCancellationError(error) else { return }
            connectionStatus = error.localizedDescription
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
        guard isPaired else { return }
        do {
            events = try await api.events()
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func startPolling() {
        guard isPaired, pollingTask == nil else { return }
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshEvents()
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

    func logout() {
        stopPolling()
        KeychainStore.delete("sessionToken")
        KeychainStore.delete("deviceId")
        isPaired = false
        events = []
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
