import SwiftUI
import UIKit

struct OnboardingView: View {
    @EnvironmentObject private var appState: AppState
    @State private var isShowingScanner = false
    @State private var didCopyCommand = false

    private let relayCommand = "npx askking@latest"

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
                Text("请在终端运行下面的命令，然后扫描终端里显示的二维码。")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 12) {
                Text(relayCommand)
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    copyRelayCommand()
                } label: {
                    Image(systemName: didCopyCommand ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(didCopyCommand ? .green : .blue)
                .accessibilityLabel(didCopyCommand ? "已复制命令" : "复制命令")
            }
            .padding(.leading, 16)
            .padding(.trailing, 8)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

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

    private func copyRelayCommand() {
        UIPasteboard.general.string = relayCommand
        didCopyCommand = true

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.2))
            didCopyCommand = false
        }
    }
}
