import SwiftUI
import UserNotifications

@main
struct AskKingApp: App {
    @StateObject private var appState = AppState()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .preferredColorScheme(appState.appearance.colorScheme)
                .onAppear {
                    appDelegate.appState = appState
                    UNUserNotificationCenter.current().delegate = appDelegate
                    NotificationActions.register()
                    Task { await appState.syncRemoteNotificationsIfAllowed() }
                }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    weak var appState: AppState?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        Task { @MainActor in
            await appState?.registerDeviceToken(token)
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in
            appState?.notice = "APNs 注册失败：\(error.localizedDescription)"
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let userInfo = response.notification.request.content.userInfo
        guard let kind = userInfo["kind"] as? String, let id = userInfo["id"] as? String else { return }

        switch response.actionIdentifier {
        case UNNotificationDefaultActionIdentifier:
            appState?.openNotification(kind: kind, id: id)
        default:
            return
        }
    }
}

enum NotificationActions {
    static let completionCategory = "ASKKING_COMPLETION"

    static func register() {
        let completion = UNNotificationCategory(
            identifier: completionCategory,
            actions: [],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        UNUserNotificationCenter.current().setNotificationCategories([completion])
    }
}
