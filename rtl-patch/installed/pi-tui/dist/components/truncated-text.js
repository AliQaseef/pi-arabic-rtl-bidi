import { alignRight, dominantDirection, getBidiSettings, reorderLine } from "../bidi.js";
import { truncateToWidth, visibleWidth } from "../utils.js";
/**
 * Text component that truncates to fit viewport width
 */
export class TruncatedText {
    text;
    paddingX;
    paddingY;
    constructor(text, paddingX = 0, paddingY = 0) {
        this.text = text;
        this.paddingX = paddingX;
        this.paddingY = paddingY;
    }
    invalidate() {
        // No cached state to invalidate currently
    }
    render(width) {
        const result = [];
        // Empty line padded to width
        const emptyLine = " ".repeat(width);
        // Add vertical padding above
        for (let i = 0; i < this.paddingY; i++) {
            result.push(emptyLine);
        }
        // Calculate available width after horizontal padding
        const availableWidth = Math.max(1, width - this.paddingX * 2);
        // Take only the first line (stop at newline)
        let singleLineText = this.text;
        const newlineIndex = this.text.indexOf("\n");
        if (newlineIndex !== -1) {
            singleLineText = this.text.substring(0, newlineIndex);
        }
        // The cut is made in logical order, then the line is painted in visual order and
        // pushed to the edge its dominant script reads from.
        const truncated = truncateToWidth(singleLineText, availableWidth);
        const visual = reorderLine(truncated);
        const displayText = getBidiSettings().align && dominantDirection(truncated) === "rtl"
            ? alignRight(visual, availableWidth)
            : visual;
        // Add horizontal padding
        const leftPadding = " ".repeat(this.paddingX);
        const rightPadding = " ".repeat(this.paddingX);
        const lineWithPadding = leftPadding + displayText + rightPadding;
        // Pad line to exactly width characters
        const lineVisibleWidth = visibleWidth(lineWithPadding);
        const paddingNeeded = Math.max(0, width - lineVisibleWidth);
        const finalLine = lineWithPadding + " ".repeat(paddingNeeded);
        result.push(finalLine);
        // Add vertical padding below
        for (let i = 0; i < this.paddingY; i++) {
            result.push(emptyLine);
        }
        return result;
    }
}
//# sourceMappingURL=truncated-text.js.map