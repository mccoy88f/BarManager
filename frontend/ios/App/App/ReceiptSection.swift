import Foundation

struct ReceiptLine {
    let text: String
    let bold: Bool
}

struct ReceiptSection {
    let title: String
    let lines: [ReceiptLine]
    let footer: [ReceiptLine]
    let letterhead: [String]

    static func from(json: [String: Any]) -> ReceiptSection {
        ReceiptSection(
            title: json["title"] as? String ?? "",
            lines: linesFrom(json["lines"]),
            footer: linesFrom(json["footer"]),
            letterhead: (json["letterhead"] as? [Any])?.compactMap { $0 as? String } ?? []
        )
    }

    private static func linesFrom(_ value: Any?) -> [ReceiptLine] {
        guard let array = value as? [Any] else { return [] }
        return array.map { item in
            if let text = item as? String {
                return ReceiptLine(text: text, bold: false)
            }
            if let obj = item as? [String: Any] {
                return ReceiptLine(text: obj["text"] as? String ?? "", bold: obj["bold"] as? Bool ?? false)
            }
            return ReceiptLine(text: "\(item)", bold: false)
        }
    }

    /// Markup testuale semplice convertito in byte ESC/POS grezzi dal plugin.
    func toPlainEscPosLines() -> [(text: String, bold: Bool, center: Bool)] {
        var out: [(String, Bool, Bool)] = []
        for line in letterhead {
            out.append((line, true, true))
        }
        if !letterhead.isEmpty {
            out.append(("--------------------------------", false, true))
        }
        out.append((title.uppercased(), true, true))
        out.append(("--------------------------------", false, true))
        for line in lines {
            out.append((line.text, line.bold, false))
        }
        if !footer.isEmpty {
            out.append(("--------------------------------", false, true))
            for line in footer {
                out.append((line.text, line.bold, false))
            }
        }
        return out
    }
}
