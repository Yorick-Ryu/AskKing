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
        List(filtered) { event in
            NavigationLink(value: EventRoute(kind: event.kind, id: event.id)) {
                EventRow(event: event)
            }
            .listRowBackground(Color.clear)
        }
        .navigationTitle("AskKing")
        .searchable(text: $query, prompt: "搜索项目、命令或状态")
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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(event.kind == "approval" ? "Codex 需要批准" : "Codex 已完成", systemImage: event.kind == "approval" ? "checkmark.shield" : "checkmark.circle")
                    .font(.headline)
                Spacer()
                StatusBadge(status: event.status)
            }
            Text(event.summary)
                .font(.subheadline)
                .lineLimit(2)
            HStack {
                Text(event.projectName)
                if !event.model.isEmpty { Text(event.model) }
                Spacer()
                Text(event.createdAt)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
    }
}

struct StatusBadge: View {
    let status: String

    var color: Color {
        switch status {
        case "pending", "waiting_reply": .orange
        case "allowed", "replied": .green
        case "denied": .red
        default: .secondary
        }
    }

    var body: some View {
        Text(status)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12), in: Capsule())
    }
}
