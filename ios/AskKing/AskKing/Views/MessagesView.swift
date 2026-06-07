import SwiftUI

struct MessagesView: View {
    @EnvironmentObject private var appState: AppState
    @State private var query = ""

    var filtered: [EventItem] {
        guard !query.isEmpty else { return appState.events }
        return appState.events.filter {
            $0.projectName.localizedCaseInsensitiveContains(query) ||
            $0.summary.localizedCaseInsensitiveContains(query) ||
            $0.status.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        List(Array(filtered.enumerated()), id: \.element.id) { index, event in
            NavigationLink(value: EventRoute(kind: event.kind, id: event.id)) {
                EventRow(event: event, showsDivider: index < filtered.count - 1)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if event.kind == "completion" {
                    Button {
                        Task { await appState.handoffCompletionToComputer(id: event.id) }
                    } label: {
                        Label(event.handoffActionTitle, systemImage: "desktopcomputer")
                    }
                    .tint(.blue)
                    .disabled(!event.canHandoffToComputer)
                }
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 0, trailing: 6))
        }
        .navigationTitle("AskKing")
        .searchable(text: $query, prompt: "搜索项目、摘要或状态")
        .refreshable { await appState.refreshEvents() }
        .task { await appState.refreshEvents() }
        .navigationDestination(for: EventRoute.self) { route in
            if route.kind == "approval" {
                ApprovalDetailView(id: route.id)
            } else {
                CompletionDetailView(id: route.id)
            }
        }
        .navigationDestination(isPresented: Binding(
            get: { appState.selectedRoute != nil },
            set: { if !$0 { appState.selectedRoute = nil } }
        )) {
            if let route = appState.selectedRoute {
                if route.kind == "approval" {
                    ApprovalDetailView(id: route.id)
                } else {
                    CompletionDetailView(id: route.id)
                }
            }
        }
        .overlay {
            if appState.events.isEmpty {
                ContentUnavailableView("暂无消息", systemImage: "tray", description: Text("审批和完成事件会显示在这里"))
            }
        }
    }
}

struct EventRow: View {
    let event: EventItem
    let showsDivider: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: event.kind == "approval" ? "checkmark.shield" : "checkmark.circle")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(.blue)
                        .frame(width: 22)

                    Text(event.kind == "approval" ? "Codex 请求审批" : "Codex 已完成")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                EventStatusView(status: event.isNotifyOnly ? "仅通知" : event.status, expiresAt: event.isNotifyOnly ? nil : event.expiresAt)
            }

            Text(event.summary.replacingOccurrences(of: "\n", with: " "))
                .font(.subheadline)
                .lineLimit(1)
                .truncationMode(.tail)

            HStack(spacing: 10) {
                Text(event.projectName)
                if !event.model.isEmpty { Text(event.model) }
                Spacer()
                Text(formattedEventTime(event.createdAt))
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if showsDivider {
                Divider()
                    .padding(.top, 8)
            }
        }
        .padding(.vertical, 12)
    }
}

struct EventStatusView: View {
    let status: String
    let expiresAt: String?

    var body: some View {
        if isWaiting, let expiresAt {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                HStack(spacing: 6) {
                    StatusBadge(status: status)
                    CountdownBadge(expiresAt: expiresAt, now: context.date)
                }
                .fixedSize(horizontal: true, vertical: false)
            }
        } else {
            StatusBadge(status: status)
                .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var isWaiting: Bool {
        status == "pending" || status == "waiting"
    }
}

struct StatusBadge: View {
    let status: String

    var color: Color {
        switch status {
        case "仅通知": .secondary
        case "pending", "waiting": .orange
        case "allowed", "replied": .green
        case "denied", "interrupted": .red
        default: .secondary
        }
    }

    var body: some View {
        Text(status)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12), in: Capsule())
    }
}

struct CountdownBadge: View {
    let expiresAt: String
    let now: Date

    var body: some View {
        Text(countdownText)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .foregroundStyle(.orange)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.orange.opacity(0.12), in: Capsule())
    }

    private var countdownText: String {
        guard let deadline = parseEventDate(expiresAt) else { return "-" }
        let remaining = Int(deadline.timeIntervalSince(now).rounded(.down))
        guard remaining > 0 else { return "已截止" }

        let minutes = remaining / 60
        let seconds = remaining % 60
        if minutes > 0 {
            return "\(minutes):\(String(format: "%02d", seconds))"
        }
        return "\(seconds)秒"
    }
}

private func formattedEventTime(_ value: String) -> String {
    guard let date = parseEventDate(value) else { return value.isEmpty ? "-" : value }
    return date.formatted(.dateTime.month(.twoDigits).day(.twoDigits).hour().minute())
}

private func parseEventDate(_ value: String) -> Date? {
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractionalFormatter.date(from: value) {
        return date
    }
    return ISO8601DateFormatter().date(from: value)
}
