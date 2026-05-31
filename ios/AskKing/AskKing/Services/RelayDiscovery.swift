import Foundation

enum RelayDiscovery {
    static func find(timeout: TimeInterval = 5) async -> URL? {
        await RelayDiscoverySession().find(timeout: timeout)
    }
}

private final class RelayDiscoverySession: NSObject, @unchecked Sendable, NetServiceBrowserDelegate, NetServiceDelegate {
    private static let serviceType = "_askking._tcp."
    private static let domain = "local."

    private let browser = NetServiceBrowser()
    private var services: [NetService] = []
    private var continuation: CheckedContinuation<URL?, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var didFinish = false

    func find(timeout: TimeInterval) async -> URL? {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                self.start(continuation: continuation, timeout: timeout)
            }
        }
    }

    private func start(continuation: CheckedContinuation<URL?, Never>, timeout: TimeInterval) {
        self.continuation = continuation
        browser.delegate = self
        browser.searchForServices(ofType: Self.serviceType, inDomain: Self.domain)
        timeoutTask = Task { [weak self] in
            let nanoseconds = UInt64(timeout * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanoseconds)
            DispatchQueue.main.async {
                self?.finish(nil)
            }
        }
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        DispatchQueue.main.async {
            guard !self.didFinish else { return }
            self.services.append(service)
            service.delegate = self
            service.resolve(withTimeout: 3)
        }
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        DispatchQueue.main.async {
            self.finish(nil)
        }
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        DispatchQueue.main.async {
            self.finish(Self.url(from: sender))
        }
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
        DispatchQueue.main.async {
            sender.stop()
            sender.delegate = nil
        }
    }

    private static func url(from service: NetService) -> URL? {
        guard var host = service.hostName, service.port > 0 else { return nil }
        while host.hasSuffix(".") {
            host.removeLast()
        }

        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = service.port
        return components.url
    }

    private func finish(_ url: URL?) {
        guard !didFinish else { return }
        didFinish = true
        timeoutTask?.cancel()
        browser.stop()
        browser.delegate = nil
        for service in services {
            service.stop()
            service.delegate = nil
        }
        services.removeAll()
        continuation?.resume(returning: url)
        continuation = nil
    }
}
