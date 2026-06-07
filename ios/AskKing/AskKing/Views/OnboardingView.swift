import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        VStack(spacing: 28) {
            Spacer(minLength: 24)

            Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                .font(.system(size: 58, weight: .semibold))
                .foregroundStyle(.blue)
                .frame(width: 96, height: 96)
                .background(.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 24, style: .continuous))

            VStack(spacing: 10) {
                Text("生成通知 Token")
                    .font(.title2.weight(.bold))
                Text("Codex Done 会为这台 iPhone 生成一个通知 Token。复制提示词给电脑上的 Codex，就能自动完成配置。")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                Task { await appState.ensureDeviceRegistration() }
            } label: {
                Label("生成 Token", systemImage: "iphone.gen3")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            NavigationLink {
                ConnectionView()
            } label: {
                Label("连接设置", systemImage: "network")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)

            Spacer()
        }
        .padding(24)
        .navigationTitle("Codex Done")
        .task {
            await appState.prepareNetworkAccess()
        }
    }
}
