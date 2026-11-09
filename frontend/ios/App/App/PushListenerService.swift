import Foundation

/**
 * Ascolto della coda push mentre l'app è in foreground/background breve.
 * Su iOS non esiste un foreground service illimitato come su Android: il loop
 * gira con l'app attiva e riparte a ogni ritorno in foreground.
 */
final class PushListenerService {
    static let shared = PushListenerService()

    private var task: URLSessionDataTask?
    private var running = false
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 40
        config.timeoutIntervalForResource = 45
        return URLSession(configuration: config)
    }()

    private init() {}

    func startIfConfigured() {
        NativePushRuntime.canPostNotifications { allowed in
            guard allowed, NativePushRuntime.isEnabled() else { return }
            self.start()
        }
    }

    func start() {
        guard !running else { return }
        running = true
        poll()
    }

    func stop() {
        running = false
        task?.cancel()
        task = nil
    }

    private func poll() {
        guard running else { return }
        let prefs = NativePushRuntime.prefs
        guard let base = prefs.string(forKey: NativePushRuntime.keyBase), !base.isEmpty,
              let token = prefs.string(forKey: NativePushRuntime.keyToken), !token.isEmpty else {
            schedule(after: 5)
            return
        }
        let since = prefs.string(forKey: NativePushRuntime.keySince) ?? NativePushRuntime.nowIso()
        let encoded = since.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? since
        guard let url = URL(string: "\(base)/api/push/feed?wait=25&since=\(encoded)") else {
            schedule(after: 5)
            return
        }

        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "X-Device-Token")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        task = session.dataTask(with: request) { [weak self] data, response, _ in
            guard let self, self.running else { return }
            defer { self.poll() }

            guard let http = response as? HTTPURLResponse else {
                self.schedule(after: 5)
                return
            }
            if http.statusCode == 401 {
                self.schedule(after: 60)
                return
            }
            guard http.statusCode == 200, let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                self.schedule(after: 5)
                return
            }

            let now = json["now"] as? String ?? since
            if let events = json["events"] as? [[String: Any]] {
                for (index, event) in events.enumerated() {
                    NativePushRuntime.showAlert(
                        id: event["id"] as? String ?? "\(index)",
                        title: event["title"] as? String ?? "BarManager",
                        body: event["body"] as? String ?? "",
                        url: event["url"] as? String ?? "/"
                    )
                }
            }
            prefs.set(now, forKey: NativePushRuntime.keySince)
        }
        task?.resume()
    }

    private func schedule(after seconds: Double) {
        DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { [weak self] in
            self?.poll()
        }
    }
}
