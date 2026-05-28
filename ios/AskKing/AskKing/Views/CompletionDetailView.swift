import SwiftUI

struct CompletionDetailView: View {
    @EnvironmentObject private var appState: AppState
    let id: String
    @State private var completion: Completion?
    @State private var reply = ""
    @State private var isWorking = false
    @FocusState private var isReplyFocused: Bool

    var body: some View {
        Form {
            if let completion {
                Section("摘要") {
                    SummaryScrollView(markdown: completion.summary)
                }

                if let existing = completion.reply, !existing.isEmpty {
                    Section("已回复") {
                        MarkdownText(existing)
                    }
                }

                Section("完成事件") {
                    FieldRow("项目", completion.projectName)
                    FieldRow("目录", completion.cwd)
                    FieldRow("模型", completion.model)
                    if completion.status == "waiting" {
                        CompletionStatusRow(status: completion.status, expiresAt: completion.expiresAt)
                    } else {
                        FieldRow("状态", completion.status)
                    }
                    FieldRow("创建时间", formattedLocalTime(completion.createdAt))
                }

                Button {
                    isReplyFocused = false
                    Task { await sendHandoffToComputer() }
                } label: {
                    Label(handoffButtonTitle(for: completion), systemImage: "desktopcomputer")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canHandoff(completion))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 10, leading: 18, bottom: 10, trailing: 18))
            } else {
                ProgressView()
            }
        }
        .contentShape(Rectangle())
        .simultaneousGesture(
            TapGesture().onEnded {
                isReplyFocused = false
            }
        )
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("完成详情")
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom) {
            if let completion {
                ReplyInputBar(
                    reply: $reply,
                    placeholder: replyPlaceholder(for: completion),
                    isFocused: $isReplyFocused,
                    isEnabled: completion.status == "waiting",
                    canSend: canSendReply(completion),
                    send: {
                        isReplyFocused = false
                        Task { await sendReply() }
                    }
                )
            }
        }
        .task { await refreshLoop() }
    }

    private func refreshLoop() async {
        await load()
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await load(silent: true)
        }
    }

    private func load(silent: Bool = false) async {
        do {
            completion = try await appState.api.completion(id: id)
        } catch {
            guard !isCancellationError(error) else { return }
            if !silent {
                appState.notice = error.localizedDescription
            }
        }
    }

    private func sendReply() async {
        isWorking = true
        defer { isWorking = false }
        do {
            let sentReply = reply.trimmingCharacters(in: .whitespacesAndNewlines)
            completion = try await appState.api.replyCompletion(id: id, reply: sentReply)
            reply = ""
            await appState.refreshEvents()
        } catch {
            guard !isCancellationError(error) else { return }
            appState.notice = error.localizedDescription
        }
    }

    private func sendHandoffToComputer() async {
        isWorking = true
        defer { isWorking = false }
        do {
            completion = try await appState.api.replyCompletion(id: id, reply: computerHandoffReply)
            reply = ""
            appState.notice = "已交接给电脑"
            await appState.refreshEvents()
        } catch {
            guard !isCancellationError(error) else { return }
            appState.notice = error.localizedDescription
        }
    }

    private func canSendReply(_ completion: Completion) -> Bool {
        !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && completion.status == "waiting" && !isWorking
    }

    private func canHandoff(_ completion: Completion) -> Bool {
        completion.status == "waiting" && !isWorking
    }

    private func handoffButtonTitle(for completion: Completion) -> String {
        if completion.reply == computerHandoffReply {
            return "已交接给电脑"
        }
        return computerHandoffReply
    }

    private func replyPlaceholder(for completion: Completion) -> String {
        if completion.status == "replied" || !(completion.reply ?? "").isEmpty {
            return "已回复"
        }
        return completion.status == "waiting" ? "下一步指令" : "不可回复"
    }
}

private struct SummaryScrollView: View {
    let markdown: String

    var body: some View {
        ScrollView {
            MarkdownText(markdown)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 2)
        }
        .frame(maxHeight: 360)
    }
}

private struct ReplyInputBar: View {
    @Binding var reply: String
    let placeholder: String
    let isFocused: FocusState<Bool>.Binding
    let isEnabled: Bool
    let canSend: Bool
    let send: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            TextField(placeholder, text: $reply)
                .textInputAutocapitalization(.never)
                .submitLabel(.send)
                .focused(isFocused)
                .disabled(!isEnabled)
                .onSubmit {
                    guard canSend else { return }
                    send()
                }

            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(canSend ? .primary : .secondary)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.leading, 18)
        .padding(.trailing, 12)
        .padding(.vertical, 11)
        .modifier(LiquidGlassInputStyle(isEnabled: isEnabled))
        .padding(.horizontal, 18)
        .padding(.bottom, 8)
    }
}

private struct LiquidGlassInputStyle: ViewModifier {
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

private struct CompletionStatusRow: View {
    let status: String
    let expiresAt: String

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            FieldRow("状态", "\(status) · \(countdownText(now: context.date))")
        }
    }

    private func countdownText(now: Date) -> String {
        guard let deadline = parseISODate(expiresAt) else { return "-" }
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

private func formattedLocalTime(_ value: String) -> String {
    guard let date = parseISODate(value) else { return value.isEmpty ? "-" : value }
    return date.formatted(.dateTime.year().month(.twoDigits).day(.twoDigits).hour().minute().second())
}

private func parseISODate(_ value: String) -> Date? {
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractionalFormatter.date(from: value) {
        return date
    }
    return ISO8601DateFormatter().date(from: value)
}
