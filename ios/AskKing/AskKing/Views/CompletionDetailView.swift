import SwiftUI

struct CompletionDetailView: View {
    @EnvironmentObject private var appState: AppState
    let id: String
    @State private var completion: Completion?
    @State private var reply = ""
    @State private var isWorking = false

    var body: some View {
        Form {
            if let completion {
                Section("完成事件") {
                    FieldRow("项目", completion.projectName)
                    FieldRow("目录", completion.cwd)
                    FieldRow("模型", completion.model)
                    FieldRow("状态", completion.status)
                    FieldRow("创建时间", completion.createdAt)
                    FieldRow("等待截止", completion.expiresAt)
                }
                Section("摘要") {
                    Text(completion.summary).textSelection(.enabled)
                }
                Section("继续指令") {
                    TextField("输入给 Codex 的下一条指令", text: $reply, axis: .vertical)
                        .lineLimit(3...6)
                    Button {
                        Task { await sendReply() }
                    } label: {
                        Label("发送继续指令", systemImage: "paperplane.fill")
                    }
                    .disabled(reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || completion.status != "waiting_reply" || isWorking)
                }
                if let existing = completion.reply, !existing.isEmpty {
                    Section("已回复") {
                        Text(existing).textSelection(.enabled)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("完成详情")
        .task { await load() }
    }

    private func load() async {
        do {
            completion = try await appState.api.completion(id: id)
        } catch {
            appState.notice = error.localizedDescription
        }
    }

    private func sendReply() async {
        isWorking = true
        defer { isWorking = false }
        do {
            completion = try await appState.api.replyCompletion(id: id, reply: reply)
            await appState.refreshEvents()
        } catch {
            appState.notice = error.localizedDescription
        }
    }
}
