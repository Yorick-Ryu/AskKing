import SwiftUI

struct MarkdownText: View {
    let markdown: String

    init(_ markdown: String) {
        self.markdown = markdown
    }

    var body: some View {
        Text(attributedText)
            .textSelection(.enabled)
    }

    private var attributedText: AttributedString {
        do {
            return try AttributedString(
                markdown: markdown.isEmpty ? "-" : markdown,
                options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
            )
        } catch {
            return AttributedString(markdown.isEmpty ? "-" : markdown)
        }
    }
}
