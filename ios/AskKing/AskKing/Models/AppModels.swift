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
    case messages
    case connection
    case settings
}

struct EventRoute: Hashable {
    let kind: String
    let id: String
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

    var isComputerHandoff: Bool {
        kind == "completion" && status == "replied" && reply == computerHandoffReply
    }

    var canHandoffToComputer: Bool {
        kind == "completion" && status == "waiting"
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
    let createdAt: String
    let expiresAt: String

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
    let createdAt: String
    let expiresAt: String
    let reply: String?
}

struct PairResponse: Codable {
    let deviceId: String
    let sessionToken: String
    let relayBaseUrl: String
}
