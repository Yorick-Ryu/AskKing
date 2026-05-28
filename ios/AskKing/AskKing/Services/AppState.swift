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
    @Published var notice: String?
    @Published var selectedRoute: EventRoute?
    @Published var notificationStatus = "未知"
    @Published var appearance: AppearanceMode = AppearanceMode(rawValue: UserDefaults.standard.string(forKey: "appearance") ?? "system") ?? .system {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: "appearance") }
    }

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
            await requestNotifications()
            await refreshEvents()
        } catch {
            notice = error.localizedDescription
        }
    }

    func requestNotifications() async {
        do {
            let center = UNUserNotificationCenter.current()
            NotificationActions.register()
            try await center.requestAuthorization(options: [.alert, .badge, .sound])
            await updateNotificationStatus()
            await MainActor.run {
                UIApplication.shared.registerForRemoteNotifications()
            }
        } catch {
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

    func registerDeviceToken(_ token: String) async {
        do {
            try await api.register(apnsToken: token)
            notice = "APNs token 已同步"
        } catch {
            notice = error.localizedDescription
        }
    }

    func testConnection() async {
        do {
            saveRelayURL()
            connectionStatus = try await api.health() ? "在线" : "异常"
        } catch {
            connectionStatus = error.localizedDescription
        }
    }

    func refreshEvents() async {
        guard isPaired else { return }
        do {
            events = try await api.events()
        } catch {
            notice = error.localizedDescription
        }
    }

    func decideFromNotification(id: String, decision: String) async {
        do {
            _ = try await api.decideApproval(id: id, decision: decision)
            await refreshEvents()
        } catch {
            notice = error.localizedDescription
        }
    }

    func replyFromNotification(id: String, reply: String) async {
        let trimmed = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            _ = try await api.replyCompletion(id: id, reply: trimmed)
            await refreshEvents()
        } catch {
            notice = error.localizedDescription
        }
    }

    func logout() {
        KeychainStore.delete("sessionToken")
        isPaired = false
        events = []
    }
}
