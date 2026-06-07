import SwiftUI

struct ApprovalDetailView: View {
    let id: String

    var body: some View {
        ContentUnavailableView("审批不可用", systemImage: "checkmark.shield", description: Text("Codex Done 只接收完成通知。"))
            .navigationTitle("审批详情")
    }
}
