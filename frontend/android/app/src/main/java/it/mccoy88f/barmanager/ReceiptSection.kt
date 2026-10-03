package it.mccoy88f.barmanager

import org.json.JSONArray
import org.json.JSONObject

/**
 * Stesso shape di ReceiptSection del backend (backend/src/reports/pdf.service.ts):
 * title, lines (stringa semplice o {text, bold}), footer e letterhead
 * opzionali. Qui si traduce in markup DantSu per la stampa ESC/POS
 * (§5.11 di docs/DEVELOPMENT.md) invece che in PDF.
 */
data class ReceiptLine(val text: String, val bold: Boolean)

data class ReceiptSection(
    val title: String,
    val lines: List<ReceiptLine>,
    val footer: List<ReceiptLine>,
    val letterhead: List<String>,
) {
    companion object {
        fun fromJson(json: JSONObject): ReceiptSection {
            return ReceiptSection(
                title = json.optString("title", ""),
                lines = linesFromJson(json.optJSONArray("lines")),
                footer = linesFromJson(json.optJSONArray("footer")),
                letterhead = stringsFromJson(json.optJSONArray("letterhead")),
            )
        }

        private fun linesFromJson(array: JSONArray?): List<ReceiptLine> {
            if (array == null) return emptyList()
            val result = mutableListOf<ReceiptLine>()
            for (i in 0 until array.length()) {
                when (val item = array.get(i)) {
                    is String -> result.add(ReceiptLine(item, false))
                    is JSONObject -> result.add(ReceiptLine(item.optString("text", ""), item.optBoolean("bold", false)))
                    else -> result.add(ReceiptLine(item.toString(), false))
                }
            }
            return result
        }

        private fun stringsFromJson(array: JSONArray?): List<String> {
            if (array == null) return emptyList()
            return (0 until array.length()).map { array.getString(it) }
        }
    }
}

/**
 * Markup DantSu ([L]/[C]/[R] per l'allineamento a inizio riga, <b> per il
 * grassetto): i caratteri che il parser di DantSu interpreta come markup
 * ([ ] < >) vengono sanificati nel testo libero (nomi prodotto, note)
 * per evitare di spezzare accidentalmente il layout o far fallire il parser.
 */
private fun sanitize(text: String): String =
    text.replace("[", "(").replace("]", ")").replace("<", "‹").replace(">", "›")

private fun renderLine(line: ReceiptLine): String {
    val safe = sanitize(line.text)
    return if (line.bold) "[L]<b>$safe</b>\n" else "[L]$safe\n"
}

fun ReceiptSection.toDantSuMarkup(): String {
    val sb = StringBuilder()
    letterhead.forEach { sb.append("[C]<b>${sanitize(it)}</b>\n") }
    if (letterhead.isNotEmpty()) sb.append("[C]--------------------------------\n")

    sb.append("[C]<b>${sanitize(title.uppercase())}</b>\n")
    sb.append("[C]--------------------------------\n")
    lines.forEach { sb.append(renderLine(it)) }

    if (footer.isNotEmpty()) {
        sb.append("[C]--------------------------------\n")
        footer.forEach { sb.append(renderLine(it)) }
    }

    return sb.toString()
}
