/**
 * TG-09: On-Page Annotations
 * 
 * This module handles highlighting manipulative elements on the page
 * based on CSS selectors from the AI analysis.
 * 
 * Dependencies: TG-07 (AI Risk Analysis)
 * Status: Ready for integration with real AI data
 */

interface AnnotationElement {
  selector: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface HighlightInfo {
  element: HTMLElement;
  overlay: HTMLElement;
  tooltip: HTMLElement;
}

// Active highlights tracker
let activeHighlights: HighlightInfo[] = [];

/**
 * Severity styling configuration
 */
const SEVERITY_STYLES = {
  low: {
    border: '2px dashed #f59e0b',
    background: 'rgba(245, 158, 11, 0.1)',
    color: '#f59e0b',
    icon: '⚠️',
  },
  medium: {
    border: '2px dashed #f97316',
    background: 'rgba(249, 115, 22, 0.15)',
    color: '#f97316',
    icon: '⚠️',
  },
  high: {
    border: '2px dashed #ef4444',
    background: 'rgba(239, 68, 68, 0.2)',
    color: '#ef4444',
    icon: '🚨',
  },
  critical: {
    border: '3px dashed #dc2626',
    background: 'rgba(220, 38, 38, 0.25)',
    color: '#dc2626',
    icon: '🔴',
  },
} as const;

/**
 * Create a styled highlight overlay for an element
 */
function createHighlight(
  targetElement: HTMLElement,
  annotation: AnnotationElement
): HighlightInfo | null {
  try {
    const rect = targetElement.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    const styles = SEVERITY_STYLES[annotation.severity];

    // Create overlay div
    const overlay = document.createElement('div');
    overlay.className = 'shop-sentinel-highlight';
    overlay.style.cssText = `
      position: absolute;
      top: ${rect.top + scrollTop}px;
      left: ${rect.left + scrollLeft}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: ${styles.border};
      background: ${styles.background};
      z-index: 9998;
      pointer-events: none;
      box-sizing: border-box;
      border-radius: 4px;
      transition: opacity 0.3s ease;
    `;

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'shop-sentinel-tooltip';
    tooltip.innerHTML = `
      <span style="font-size: 16px; margin-right: 6px;">${styles.icon}</span>
      <strong style="text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">${annotation.severity} Risk</strong>
      <div style="margin-top: 4px; font-size: 12px;">${annotation.reason}</div>
    `;
    tooltip.style.cssText = `
      position: absolute;
      top: ${rect.top + scrollTop - 10}px;
      left: ${rect.left + scrollLeft}px;
      transform: translateY(-100%);
      background: white;
      color: ${styles.color};
      border: 2px solid ${styles.color};
      border-radius: 8px;
      padding: 8px 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 9999;
      pointer-events: none;
      max-width: 300px;
      line-height: 1.4;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;

    // Append to body
    document.body.appendChild(overlay);
    document.body.appendChild(tooltip);

    // Fade in
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      tooltip.style.opacity = '1';
    });

    return {
      element: targetElement,
      overlay,
      tooltip,
    };
  } catch (error) {
    console.error('❌ Error creating highlight:', error);
    return null;
  }
}

/**
 * Clear all active highlights from the page
 */
export function clearAnnotations(): { cleared: number } {
  console.log(`🧹 Clearing ${activeHighlights.length} annotations...`);

  activeHighlights.forEach(({ overlay, tooltip }) => {
    // Fade out
    overlay.style.opacity = '0';
    tooltip.style.opacity = '0';

    // Remove after animation
    setTimeout(() => {
      overlay.remove();
      tooltip.remove();
    }, 300);
  });

  const clearedCount = activeHighlights.length;
  activeHighlights = [];

  return { cleared: clearedCount };
}

/**
 * Display annotations for the given elements
 * 
 * TODO [TG-07 Integration]: This function will receive real AI data
 * Current: Uses mock selectors for development
 * After TG-07 merge: Will receive actual AI-detected elements
 */
export function displayAnnotations(elements: AnnotationElement[]): {
  highlighted: number;
  failed: number;
} {
  console.log('🎨 Displaying annotations for elements:', elements);

  // Clear existing highlights first
  clearAnnotations();

  let highlighted = 0;
  let failed = 0;

  elements.forEach((annotation) => {
    try {
      // Find all matching elements for this selector
      const matchedElements = document.querySelectorAll(annotation.selector);

      if (matchedElements.length === 0) {
        console.warn(`⚠️ No elements found for selector: ${annotation.selector}`);
        failed++;
        return;
      }

      // Highlight all matched elements
      matchedElements.forEach((element) => {
        const highlightInfo = createHighlight(element as HTMLElement, annotation);
        if (highlightInfo) {
          activeHighlights.push(highlightInfo);
          highlighted++;
        } else {
          failed++;
        }
      });
    } catch (error) {
      console.error(`❌ Error processing selector "${annotation.selector}":`, error);
      failed++;
    }
  });

  console.log(`✅ Annotations displayed: ${highlighted} highlighted, ${failed} failed`);

  return { highlighted, failed };
}

/**
 * Update highlight positions on scroll/resize
 * This ensures highlights stay aligned with their target elements
 */
function updateHighlightPositions() {
  activeHighlights.forEach(({ element, overlay, tooltip }) => {
    try {
      const rect = element.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

      overlay.style.top = `${rect.top + scrollTop}px`;
      overlay.style.left = `${rect.left + scrollLeft}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      tooltip.style.top = `${rect.top + scrollTop - 10}px`;
      tooltip.style.left = `${rect.left + scrollLeft}px`;
    } catch (error) {
      console.error('Error updating highlight position:', error);
    }
  });
}

// Listen for scroll and resize to update positions
let scrollTimeout: number;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = window.setTimeout(updateHighlightPositions, 100);
}, { passive: true });

window.addEventListener('resize', () => {
  updateHighlightPositions();
}, { passive: true });

/**
 * TODO [TG-07 Integration Point]:
 * When TG-07 is merged, the AI response will include an `elements` array.
 * Replace the mock data below with actual AI-detected elements.
 * 
 * Example AI response structure (from TG-07):
 * {
 *   elements: [
 *     {
 *       selector: '.countdown-timer',
 *       reason: 'False urgency - countdown timer',
 *       severity: 'high'
 *     },
 *     {
 *       selector: 'button[class*="scarcity"]',
 *       reason: 'Artificial scarcity warning',
 *       severity: 'medium'
 *     }
 *   ]
 * }
 */

/**
 * Mock annotations for testing (TG-09 Development)
 * This will be removed when TG-07 is integrated
 */
export const MOCK_ANNOTATIONS: AnnotationElement[] = [
  {
    selector: '.countdown, [class*="countdown"], [id*="countdown"]',
    reason: 'False urgency - Countdown timer detected',
    severity: 'high',
  },
  {
    selector: 'button[class*="scarcity"], [class*="limited"], [class*="only-left"]',
    reason: 'Artificial scarcity warning',
    severity: 'medium',
  },
  {
    selector: '[class*="popup"], [class*="modal"][class*="subscribe"]',
    reason: 'Intrusive popup detected',
    severity: 'low',
  },
];
