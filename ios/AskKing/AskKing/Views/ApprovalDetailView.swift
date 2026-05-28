import SwiftUI

struct ApprovalDetailView: View {
    @EnvironmentObject private var appState: AppState
    let id: String
    @State private var approval: Approval?
    @State private var isWorking = false

    var body: some View {
        Form {
            if let approval {
                Section("命令") {
                    ScrollView {
                        Text(approval.commandFull)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 2)
                    }
                    .frame(maxHeight: 360)
                }

                if approval.hasReason || approval.hasRiskSummary {
                    Section("说明") {
                        if approval.hasReason {
                            MarkdownFieldRow("原因", approval.reason)
                        }
                        if approval.hasRiskSummary {
                            MarkdownFieldRow("风险", approval.riskSummary)
                        }
                    }
                }

                Section("请求") {
                    FieldRow("项目", approval.projectName)
                    FieldRow("目录", approval.cwd)
                    FieldRow("模型", approval.model)
                    if approval.status == "pending" {
                        ApprovalStatusRow(status: approval.status, expiresAt: approval.expiresAt)
                    } else {
                        FieldRow("状态", approval.status)
                    }
                    FieldRow("创建时间", formattedApprovalTime(approval.createdAt))
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("审批详情")
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom) {
            if let approval, approval.status == "pending" {
                ApprovalActionBar(
                    isWorking: isWorking,
                    allow: { Task { await decide("allow") } },
                    deny: { Task { await decide("deny") } }
                )
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            approval = try await appState.api.approval(id: id)
        } catch {
            guard !isCancellationError(error) else { return }
            appState.notice = error.localizedDescription
        }
    }

    private func decide(_ decision: String) async {
        isWorking = true
        defer { isWorking = false }
        do {
            approval = try await appState.api.decideApproval(id: id, decision: decision)
            await appState.refreshEvents()
        } catch {
            guard !isCancellationError(error) else { return }
            appState.notice = error.localizedDescription
        }
    }
}

private struct ApprovalActionBar: View {
    let isWorking: Bool
    let allow: () -> Void
    let deny: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(role: .destructive, action: deny) {
                Label("拒绝", systemImage: "xmark")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.red)

            Button(action: allow) {
                Label("同意", systemImage: "checkmark")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.blue)
        }
        .disabled(isWorking)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .modifier(ApprovalLiquidGlassActionStyle(isEnabled: !isWorking))
        .padding(.horizontal, 18)
        .padding(.bottom, 8)
    }
}

private struct ApprovalLiquidGlassActionStyle: ViewModifier {
    let isEnabled: Bool

    func body(content: Content) -> some View {
        content
            .background(alignment: .center) {
                if #available(iOS 26.0, *) {
                    Capsule()
                        .fill(Color.white.opacity(0.20))
                        .glassEffect(.regular.interactive(isEnabled), in: Capsule())
                } else {
                    Capsule()
                        .fill(.regularMaterial)
                        .overlay {
                            Capsule()
                                .fill(Color.white.opacity(0.22))
                        }
                }
            }
            .overlay {
                Capsule()
                    .strokeBorder(Color.white.opacity(0.38), lineWidth: 0.7)
            }
            .shadow(color: .black.opacity(0.08), radius: 18, y: 8)
    }
}

private struct ApprovalStatusRow: View {
    let status: String
    let expiresAt: String

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            FieldRow("状态", "\(status) · \(countdownText(now: context.date))")
        }
    }

    private func countdownText(now: Date) -> String {
        guard let deadline = parseApprovalDate(expiresAt) else { return "-" }
        let remaining = Int(deadline.timeIntervalSince(now).rounded(.down))
        guard remaining > 0 else { return "已截止" }

        let minutes = remaining / 60
        let seconds = remaining % 60
        if minutes > 0 {
            return "\(minutes)分\(String(format: "%02d", seconds))秒"
        }
        return "\(seconds)秒"
    }
}

private func formattedApprovalTime(_ value: String) -> String {
    guard let date = parseApprovalDate(value) else { return value.isEmpty ? "-" : value }
    return date.formatted(.dateTime.year().month(.twoDigits).day(.twoDigits).hour().minute().second())
}

private func parseApprovalDate(_ value: String) -> Date? {
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractionalFormatter.date(from: value) {
        return date
    }
    return ISO8601DateFormatter().date(from: value)
}

struct MarkdownFieldRow: View {
    let title: String
    let value: String

    init(_ title: String, _ value: String) {
        self.title = title
        self.value = value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            MarkdownText(value)
        }
    }
}

struct FieldRow: View {
    let title: String
    let value: String

    init(_ title: String, _ value: String) {
        self.title = title
        self.value = value.isEmpty ? "-" : value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).textSelection(.enabled)
        }
    }
}
