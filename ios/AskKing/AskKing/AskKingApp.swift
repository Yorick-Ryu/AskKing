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
        case NotificationActions.allowAction:
            await appState?.decideApproval(id: id, decision: "allow")
        case NotificationActions.denyAction:
            await appState?.decideApproval(id: id, decision: "deny")
        case NotificationActions.replyAction:
            if let textResponse = response as? UNTextInputNotificationResponse {
                await appState?.replyCompletion(id: id, reply: textResponse.userText)
            }
        default:
            appState?.openNotification(kind: kind, id: id)
        }
    }
}

enum NotificationActions {
    static let approvalCategory = "ASKKING_APPROVAL"
    static let approvalReviewCategory = "ASKKING_APPROVAL_REVIEW"
    static let completionCategory = "ASKKING_COMPLETION"
    static let allowAction = "ASKKING_ALLOW"
    static let denyAction = "ASKKING_DENY"
    static let replyAction = "ASKKING_REPLY"

    static func register() {
        let allow = UNNotificationAction(
            identifier: allowAction,
            title: "允许",
            options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "checkmark.circle")
        )
        let deny = UNNotificationAction(
            identifier: denyAction,
            title: "拒绝",
            options: [.authenticationRequired, .destructive],
            icon: UNNotificationActionIcon(systemImageName: "xmark.circle")
        )
        let reply = UNTextInputNotificationAction(
            identifier: replyAction,
            title: "回复",
            options: [.authenticationRequired],
            textInputButtonTitle: "发送",
            textInputPlaceholder: "下一步指令"
        )
        let approval = UNNotificationCategory(
            identifier: approvalCategory,
            actions: [allow, deny],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        let approvalReview = UNNotificationCategory(
            identifier: approvalReviewCategory,
            actions: [allow, deny],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        let completion = UNNotificationCategory(
            identifier: completionCategory,
            actions: [reply],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        UNUserNotificationCenter.current().setNotificationCategories([approval, approvalReview, completion])
    }
}
