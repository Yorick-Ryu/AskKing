import SwiftUI

struct ApprovalDetailView: View {
    @EnvironmentObject private var appState: AppState
    let id: String
    @State private var approval: Approval?
    @State private var isWorking = false

    var body: some View {
        Form {
            if let approval {
                Section("请求") {
                    FieldRow("项目", approval.projectName)
                    FieldRow("目录", approval.cwd)
                    FieldRow("模型", approval.model)
                    FieldRow("状态", approval.status)
                    FieldRow("创建时间", approval.createdAt)
                    FieldRow("过期时间", approval.expiresAt)
                }
                Section("命令") {
                    Text(approval.commandFull)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                }
                Section("说明") {
                    FieldRow("原因", approval.reason)
                    FieldRow("风险", approval.riskSummary)
                }
                if approval.status == "pending" {
                    Section {
                        Button {
                            Task { await decide("allow") }
                        } label: {
                            Label("允许", systemImage: "checkmark.circle.fill")
                        }
                        .tint(.blue)
                        .disabled(isWorking)

                        Button(role: .destructive) {
                            Task { await decide("deny") }
                        } label: {
                            Label("拒绝", systemImage: "xmark.octagon.fill")
                        }
                        .disabled(isWorking)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("审批详情")
        .task { await load() }
    }

    private func load() async {
        do {
            approval = try await appState.api.approval(id: id)
        } catch {
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
            appState.notice = error.localizedDescription
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
