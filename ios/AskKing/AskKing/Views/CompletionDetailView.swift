import SwiftUI

struct CompletionDetailView: View {
    @EnvironmentObject private var appState: AppState
    let id: String
    @State private var completion: Completion?

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
                    if completion.isNotifyOnly {
                        FieldRow("状态", "仅通知")
                    } else if completion.status == "waiting" {
                        CompletionStatusRow(status: completion.status, expiresAt: completion.expiresAt)
                    } else {
                        FieldRow("状态", completion.status)
                    }
                    FieldRow("创建时间", formattedLocalTime(completion.createdAt))
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("完成详情")
        .toolbar(.hidden, for: .tabBar)
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

struct FieldRow: View {
    let title: String
    let value: String

    init(_ title: String, _ value: String) {
        self.title = title
        self.value = value
    }

    var body: some View {
        HStack(alignment: .top) {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value.isEmpty ? "-" : value)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
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
