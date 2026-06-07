import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject private var appState: AppState
    @State private var isShowingScanner = false

    var body: some View {
        VStack(spacing: 28) {
            Spacer(minLength: 24)

            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 58, weight: .semibold))
                .foregroundStyle(.blue)
                .frame(width: 96, height: 96)
                .background(.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 24, style: .continuous))

            VStack(spacing: 10) {
                Text("连接 AskKing Relay")
                    .font(.title2.weight(.bold))
                Text("请输入电脑端生成的配对码，或扫描配对二维码。")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                isShowingScanner = true
            } label: {
                Label("扫描配对二维码", systemImage: "qrcode.viewfinder")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            NavigationLink {
                ConnectionView()
            } label: {
                Label("手动输入连接信息", systemImage: "keyboard")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)

            Spacer()
        }
        .padding(24)
        .navigationTitle("AskKing")
        .sheet(isPresented: $isShowingScanner) {
            QRCodeScannerView { rawValue in
                Task { await appState.pair(scannedValue: rawValue) }
            }
        }
        .task {
            await appState.prepareNetworkAccess()
        }
    }
}
