import Foundation

struct RelayAPI {
    var baseURL: URL
    var sessionToken: String?

    func health() async throws -> Bool {
        let (_, response) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("health"))
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    func pair(code: String, name: String) async throws -> PairResponse {
        try await request("api/devices/pair", method: "POST", body: ["code": code, "name": name], authenticated: false)
    }

    func register(apnsToken: String) async throws {
        let _: EmptyResponse = try await request("api/mobile/device-token", method: "PUT", body: ["apnsToken": apnsToken], authenticated: true)
    }

    func events() async throws -> [EventItem] {
        let response: EventsResponse = try await request("api/mobile/events", method: "GET", body: Optional<String>.none, authenticated: true)
        return response.events
    }

    func approval(id: String) async throws -> Approval {
        let response: ApprovalResponse = try await request("api/mobile/approvals/\(id)", method: "GET", body: Optional<String>.none, authenticated: true)
        return response.approval
    }

    func decideApproval(id: String, decision: String) async throws -> Approval {
        let response: ApprovalResponse = try await request("api/mobile/approvals/\(id)/decision", method: "POST", body: ["decision": decision], authenticated: true)
        return response.approval
    }

    func completion(id: String) async throws -> Completion {
        let response: CompletionResponse = try await request("api/mobile/completions/\(id)", method: "GET", body: Optional<String>.none, authenticated: true)
        return response.completion
    }

    func replyCompletion(id: String, reply: String) async throws -> Completion {
        let response: CompletionResponse = try await request("api/mobile/completions/\(id)/reply", method: "POST", body: ["reply": reply], authenticated: true)
        return response.completion
    }

    private func request<T: Decodable, Body: Encodable>(_ path: String, method: String, body: Body?, authenticated: Bool) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        if authenticated, let sessionToken {
            request.setValue("Bearer \(sessionToken)", forHTTPHeaderField: "authorization")
        }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(status)"
            throw NSError(domain: "RelayAPI", code: status, userInfo: [NSLocalizedDescriptionKey: message])
        }
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

struct EventsResponse: Codable { let events: [EventItem] }
struct ApprovalResponse: Codable { let approval: Approval }
struct CompletionResponse: Codable { let completion: Completion }
struct EmptyResponse: Codable {}
