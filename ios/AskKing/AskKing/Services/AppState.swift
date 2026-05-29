import Foundation
import SwiftUI
import UIKit
import UserNotifications
import Darwin

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

    func saveRelayURL() {
        UserDefaults.standard.set(relayURLString, forKey: "relayURL")
    }

    func hookConfigSummary() -> String {
        """
        ASKKING_RELAY_URL=\(relayURLString)
        ASKKING_CLIENT_TOKEN=<relay 生成的 client token>
        hooks/askking_codex_hook.py
        """
    }

    func pair(code: String) async {
        do {
            saveRelayURL()
            let response = try await api.pair(code: code, name: UIDevice.current.name)
            KeychainStore.set(response.sessionToken, for: "sessionToken")
            UserDefaults.standard.set(response.deviceId, forKey: "deviceId")
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

    func autoDiscoverRelayIfNeeded() async {
        guard shouldAutoDiscoverRelay else { return }
        await discoverRelay(silent: true)
    }

    func discoverRelay() async {
        await discoverRelay(silent: false)
    }

    private var shouldAutoDiscoverRelay: Bool {
        guard let url = URL(string: relayURLString), let host = url.host?.lowercased() else {
            return true
        }
        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }

    private func discoverRelay(silent: Bool) async {
        guard !isDiscoveringRelay else { return }
        isDiscoveringRelay = true
        if !silent {
            connectionStatus = "正在扫描局域网"
        }
        defer { isDiscoveringRelay = false }

        let port = URL(string: relayURLString)?.port ?? 8787
        guard let relayURL = await Self.findRelay(port: port) else {
            if !silent {
                connectionStatus = "未找到 Relay"
                notice = "没有在当前局域网发现 AskKing Relay"
            }
            return
        }

        relayURLString = relayURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        saveRelayURL()
        connectionStatus = "在线"
        if !silent {
            notice = "已发现 Relay：\(relayURLString)"
        }
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
            notice = "已交接给电脑"
            await refreshEvents()
        } catch {
            guard !isCancellationError(error) else { return }
            notice = error.localizedDescription
        }
    }

    func logout() {
        stopPolling()
        KeychainStore.delete("sessionToken")
        isPaired = false
        events = []
    }

    private static func findRelay(port: Int) async -> URL? {
        let candidates = localSubnetCandidates(port: port)
        return await withTaskGroup(of: URL?.self) { group in
            for url in candidates {
                group.addTask {
                    await isRelayHealthy(url) ? url : nil
                }
            }

            for await url in group {
                if let url {
                    group.cancelAll()
                    return url
                }
            }
            return nil
        }
    }

    private static func isRelayHealthy(_ baseURL: URL) async -> Bool {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 0.35
        config.timeoutIntervalForResource = 0.35
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }

        do {
            let (_, response) = try await session.data(from: baseURL.appendingPathComponent("health"))
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private static func localSubnetCandidates(port: Int) -> [URL] {
        guard let localIP = localWiFiIPv4() else { return [] }
        let parts = localIP.split(separator: ".")
        guard parts.count == 4 else { return [] }
        let prefix = parts.prefix(3).joined(separator: ".")
        return (1...254).compactMap { host in
            let ip = "\(prefix).\(host)"
            guard ip != localIP else { return nil }
            return URL(string: "http://\(ip):\(port)")
        }
    }

    private static func localWiFiIPv4() -> String? {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0, let firstInterface = interfaces else { return nil }
        defer { freeifaddrs(interfaces) }

        for pointer in sequence(first: firstInterface, next: { $0.pointee.ifa_next }) {
            let interface = pointer.pointee
            let name = String(cString: interface.ifa_name)
            let addressFamily = interface.ifa_addr.pointee.sa_family
            guard name == "en0", addressFamily == UInt8(AF_INET) else { continue }

            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                interface.ifa_addr,
                socklen_t(interface.ifa_addr.pointee.sa_len),
                &hostname,
                socklen_t(hostname.count),
                nil,
                0,
                NI_NUMERICHOST
            )
            if result == 0 {
                return String(cString: hostname)
            }
        }
        return nil
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
