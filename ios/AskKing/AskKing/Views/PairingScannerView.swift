import AVFoundation
import SwiftUI

struct QRCodeScannerView: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode, dismiss: dismiss)
    }

    func makeUIViewController(context: Context) -> UIViewController {
        let controller = UIViewController()
        controller.view.backgroundColor = .black

        let session = AVCaptureSession()
        context.coordinator.session = session

        guard
            let device = AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input)
        else {
            context.coordinator.finishWithNotice("无法打开相机")
            return controller
        }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            context.coordinator.finishWithNotice("无法读取二维码")
            return controller
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(context.coordinator, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = controller.view.bounds
        context.coordinator.preview = preview
        controller.view.layer.addSublayer(preview)

        let label = UILabel()
        label.text = "扫描终端里的 AskKing 配对二维码"
        label.textColor = .white
        label.font = .preferredFont(forTextStyle: .headline)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        controller.view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor, constant: 20),
            label.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor, constant: -20),
            label.bottomAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.bottomAnchor, constant: -32)
        ])

        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        context.coordinator.preview?.frame = uiViewController.view.bounds
    }

    static func dismantleUIViewController(_ uiViewController: UIViewController, coordinator: Coordinator) {
        coordinator.session?.stopRunning()
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        var session: AVCaptureSession?
        var preview: AVCaptureVideoPreviewLayer?
        private let onCode: (String) -> Void
        private let dismiss: DismissAction
        private var didScan = false

        init(onCode: @escaping (String) -> Void, dismiss: DismissAction) {
            self.onCode = onCode
            self.dismiss = dismiss
        }

        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard
                !didScan,
                let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                let value = object.stringValue
            else { return }

            didScan = true
            session?.stopRunning()
            dismiss()
            onCode(value)
        }

        func finishWithNotice(_ message: String) {
            DispatchQueue.main.async {
                self.dismiss()
                self.onCode("askking://error?message=\(message)")
            }
        }
    }
}
