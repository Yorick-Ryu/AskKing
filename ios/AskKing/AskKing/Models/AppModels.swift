import Foundation
import SwiftUI

let computerHandoffReply = "交接给电脑"

enum AppearanceMode: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "跟随系统"
        case .light: "浅色"
        case .dark: "深色"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

enum AppTab: Hashable {
    case connection
    case settings
}

struct EventRoute: Hashable {
    let kind: String
    let id: String
}

struct AskKingPairingPayload {
    let relayURLString: String
    let code: String

    init?(rawValue: String) {
        guard
            let components = URLComponents(string: rawValue),
            components.scheme == "askking",
            components.host == "pair"
        else { return nil }

        let items = components.queryItems ?? []
        guard
            let relayURL = items.first(where: { $0.name == "relayUrl" })?.value,
            let code = items.first(where: { $0.name == "code" })?.value,
            URL(string: relayURL) != nil,
            !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }

        self.relayURLString = relayURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.code = code
    }
}

struct EventItem: Identifiable, Codable, Hashable {
    let kind: String
    let id: String
    let projectName: String
    let model: String
    let status: String
    let summary: String
    let createdAt: String
    let expiresAt: String?
    let reply: String?
    let notifyOnly: Bool?

    var isNotifyOnly: Bool {
        notifyOnly == true
    }

    var isComputerHandoff: Bool {
        kind == "completion" && status == "replied" && reply == computerHandoffReply
    }

    var canHandoffToComputer: Bool {
        kind == "completion" && status == "waiting" && !isNotifyOnly
    }

    var handoffActionTitle: String {
        isComputerHandoff ? "已交接" : "交接"
    }
}

struct Approval: Identifiable, Codable {
    let id: String
    let projectName: String
    let cwd: String
    let model: String
    let commandSummary: String
    let commandFull: String
    let reason: String
    let riskSummary: String
    let status: String
    let notifyOnly: Bool?
    let createdAt: String
    let expiresAt: String

    var isNotifyOnly: Bool {
        notifyOnly == true
    }

    var isHighRisk: Bool {
        riskSummary.localizedCaseInsensitiveContains("high risk")
    }

    var hasReason: Bool {
        !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var hasRiskSummary: Bool {
        !riskSummary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct Completion: Identifiable, Codable {
    let id: String
    let projectName: String
    let cwd: String
    let model: String
    let summary: String
    let status: String
    let notifyOnly: Bool?
    let createdAt: String
    let expiresAt: String
    let reply: String?

    var isNotifyOnly: Bool {
        notifyOnly == true
    }
}

struct PairResponse: Codable {
    let deviceId: String
    let sessionToken: String
    let relayBaseUrl: String
}
