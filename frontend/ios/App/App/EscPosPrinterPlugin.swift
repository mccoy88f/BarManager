import Foundation
import Capacitor
import Network

/**
 * Stampa diretta ESC/POS via socket TCP (§5.11), pari all'plugin Android.
 * Chiamata JS: Escpos.print({ host, port, sections }).
 */
@objc(EscPosPrinterPlugin)
public class EscPosPrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EscPosPrinterPlugin"
    public let jsName = "Escpos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
    ]

    private let charactersPerLine = 46

    @objc func print(_ call: CAPPluginCall) {
        guard let host = call.getString("host")?.trimmingCharacters(in: .whitespacesAndNewlines), !host.isEmpty else {
            call.reject("Parametri mancanti: host e sections sono obbligatori.")
            return
        }
        let port = call.getInt("port") ?? 9100
        guard let sectionsAny = call.getArray("sections") else {
            call.reject("Parametri mancanti: host e sections sono obbligatori.")
            return
        }

        let sections: [ReceiptSection]
        do {
            sections = try sectionsAny.map { item -> ReceiptSection in
                guard let dict = item as? [String: Any] else {
                    throw NSError(domain: "Escpos", code: 1, userInfo: [NSLocalizedDescriptionKey: "Sezione non valida"])
                }
                return ReceiptSection.from(json: dict)
            }
        } catch {
            call.reject("Dati documento non validi: \(error.localizedDescription)", nil, error)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let payload = self.buildEscPosData(sections: sections)
                try self.sendTcp(host: host, port: UInt16(port), data: payload)
                call.resolve()
            } catch {
                call.reject("Stampante non raggiungibile (\(host):\(port)): \(error.localizedDescription)", nil, error)
            }
        }
    }

    private func buildEscPosData(sections: [ReceiptSection]) -> Data {
        var data = Data()
        // Init
        data.append(contentsOf: [0x1B, 0x40])
        for section in sections {
            for line in section.toPlainEscPosLines() {
                // Alignment
                data.append(contentsOf: line.center ? [0x1B, 0x61, 0x01] : [0x1B, 0x61, 0x00])
                // Bold
                data.append(contentsOf: line.bold ? [0x1B, 0x45, 0x01] : [0x1B, 0x45, 0x00])
                let text = String(line.text.prefix(charactersPerLine))
                if let encoded = text.data(using: .isoLatin1) ?? text.data(using: .utf8) {
                    data.append(encoded)
                }
                data.append(0x0A)
            }
            data.append(0x0A)
        }
        // Cut
        data.append(contentsOf: [0x1D, 0x56, 0x00])
        return data
    }

    private func sendTcp(host: String, port: UInt16, data: Data) throws {
        let lock = NSLock()
        var resultError: Error?
        let sem = DispatchSemaphore(value: 0)

        let connection = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                connection.send(content: data, completion: .contentProcessed { error in
                    lock.lock()
                    resultError = error
                    lock.unlock()
                    connection.cancel()
                    sem.signal()
                })
            case .failed(let error):
                lock.lock()
                resultError = error
                lock.unlock()
                connection.cancel()
                sem.signal()
            case .cancelled:
                break
            default:
                break
            }
        }
        connection.start(queue: .global(qos: .userInitiated))

        let wait = sem.wait(timeout: .now() + 8)
        if wait == .timedOut {
            connection.cancel()
            throw NSError(domain: "Escpos", code: 2, userInfo: [NSLocalizedDescriptionKey: "Timeout di connessione"])
        }
        if let error = resultError {
            throw error
        }
        // Brief pause so the printer buffer can flush, mirroring Android.
        Thread.sleep(forTimeInterval: 0.5)
    }
}
