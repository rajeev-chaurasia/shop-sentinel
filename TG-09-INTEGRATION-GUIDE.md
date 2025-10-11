# TG-09: On-Page Annotations - Integration Guide

**Status**: ✅ Ready for TG-07 Integration  
**Owner**: Mid-level Engineer 1  
**Dependencies**: TG-07 (Full Risk Analysis Prompt & Logic)  
**Sprint**: Sprint 2

## Overview

TG-09 implements the visual annotation system that highlights manipulative elements on web pages. The system is **fully functional** with mock data and requires minimal changes when TG-07 (AI Risk Analysis) is merged.

## What's Implemented ✅

### 1. Core Annotation System (`src/content/annotator.ts`)
- ✅ **Highlight Overlay System**: Styled divs positioned over target elements
- ✅ **Tooltip System**: Shows severity and reason for each highlight
- ✅ **Severity Styling**: Color-coded borders and backgrounds (low/medium/high/critical)
- ✅ **Position Tracking**: Auto-updates highlights on scroll/resize
- ✅ **Fade In/Out Animations**: Smooth visual transitions
- ✅ **Clear Functionality**: Remove all highlights at once

### 2. Message Handlers (`src/content/content.ts`)
- ✅ **HIGHLIGHT_ELEMENTS**: Displays annotations for given elements
- ✅ **CLEAR_HIGHLIGHTS**: Removes all annotations
- ✅ **Mock Data Integration**: Uses `MOCK_ANNOTATIONS` for testing

### 3. UI Controls (`src/popup/App.tsx`)
- ✅ **Toggle Button**: Show/Hide annotations
- ✅ **Visual State**: Button changes based on annotation visibility
- ✅ **Only Shows When Issues Found**: Conditional rendering when `allSignals.length > 0`

## Mock Data (Current Implementation)

```typescript
// src/content/annotator.ts (lines 195-216)
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
```

## TG-07 Integration Instructions 🔧

When TG-07 (AI Risk Analysis) is merged, follow these steps:

### Step 1: Update AI Response Type

In `src/types/analysis.ts`, ensure the `AnalysisResult` includes:

```typescript
export interface AnalysisResult {
  // ... existing fields
  
  // Add this for TG-09:
  elements?: AnnotationElement[];  // CSS selectors from AI
}

export interface AnnotationElement {
  selector: string;      // CSS selector for the element
  reason: string;        // Why it's flagged (e.g., "False urgency timer")
  severity: 'low' | 'medium' | 'high' | 'critical';
}
```

### Step 2: Update Content Script Analysis

In `src/content/content.ts`, modify the `handleAnalyzePage` function to include AI-detected elements:

```typescript
// After AI analysis completes (around line 350-370)
const analysis = {
  url: window.location.href,
  timestamp: Date.now(),
  pageType,
  security,
  domain,
  payment,
  contact,
  policies,
  totalRiskScore,
  riskLevel,
  allSignals,
  
  // ADD THIS: Elements to annotate from AI
  elements: aiSignals
    .filter(signal => signal.category === 'dark-pattern')
    .map(signal => ({
      selector: signal.details || '', // AI should provide CSS selector
      reason: signal.reason,
      severity: signal.severity,
    })),
    
  analysisVersion: '1.0.0',
  isEcommerceSite: true,
  aiEnabled: aiAvailable,
  aiSignalsCount: aiSignals.length,
};
```

### Step 3: Update Popup to Use Real Data

In `src/popup/App.tsx`, modify the `handleToggleAnnotations` function:

**REPLACE THIS** (lines 171-192):
```typescript
const handleToggleAnnotations = async () => {
  try {
    if (annotationsVisible) {
      // Clear annotations
      const response = await MessagingService.sendToActiveTab('CLEAR_HIGHLIGHTS');
      if (response.success) {
        setAnnotationsVisible(false);
        console.log('✅ Annotations cleared');
      }
    } else {
      // Show annotations with mock data (TG-07 will provide real data)
      const response = await MessagingService.sendToActiveTab('HIGHLIGHT_ELEMENTS', {
        // TODO [TG-07 Integration]: Replace with real AI elements
        // Currently using mock data from annotator
        elements: undefined, // Will use MOCK_ANNOTATIONS in content script
      });
      
      if (response.success) {
        setAnnotationsVisible(true);
        console.log(`✅ Annotations displayed: ${response.data?.highlighted || 0} elements`);
      }
    }
  } catch (error) {
    console.error('❌ Error toggling annotations:', error);
    setError('Failed to toggle annotations');
  }
};
```

**WITH THIS**:
```typescript
const handleToggleAnnotations = async () => {
  try {
    if (annotationsVisible) {
      // Clear annotations
      const response = await MessagingService.sendToActiveTab('CLEAR_HIGHLIGHTS');
      if (response.success) {
        setAnnotationsVisible(false);
        console.log('✅ Annotations cleared');
      }
    } else {
      // Show annotations with REAL AI data from analysis
      const elements = analysisResult?.elements || [];
      
      if (elements.length === 0) {
        console.warn('⚠️ No elements to annotate');
        return;
      }
      
      const response = await MessagingService.sendToActiveTab('HIGHLIGHT_ELEMENTS', {
        elements, // Real AI-detected elements!
      });
      
      if (response.success) {
        setAnnotationsVisible(true);
        console.log(`✅ Annotations displayed: ${response.data?.highlighted || 0} elements`);
      }
    }
  } catch (error) {
    console.error('❌ Error toggling annotations:', error);
    setError('Failed to toggle annotations');
  }
};
```

### Step 4: Remove Mock Data (Optional)

Once TG-07 is integrated and tested, you can remove the mock annotations:

In `src/content/annotator.ts`:
1. Remove lines 195-216 (`MOCK_ANNOTATIONS` export)
2. Remove the export from `src/content/content.ts` line 5

In `src/content/content.ts`:
```typescript
// REMOVE this line:
import { displayAnnotations, clearAnnotations, MOCK_ANNOTATIONS } from './annotator';

// REPLACE with:
import { displayAnnotations, clearAnnotations } from './annotator';
```

And update `handleHighlightElements`:
```typescript
async function handleHighlightElements(payload: any) {
  console.log('🎨 Highlighting elements...', payload);
  
  // Just use the payload directly (no mock fallback needed)
  const elementsToHighlight = payload?.elements || [];
  
  if (elementsToHighlight.length === 0) {
    console.warn('⚠️ No elements provided for highlighting');
    return { highlighted: 0, failed: 0 };
  }
  
  const result = displayAnnotations(elementsToHighlight);
  return result;
}
```

## Expected AI Response Format (from TG-07)

The AI service should detect elements and return them in this format:

```json
{
  "elements": [
    {
      "selector": ".countdown-timer",
      "reason": "False urgency - fake countdown timer",
      "severity": "high"
    },
    {
      "selector": "button.limited-stock",
      "reason": "Artificial scarcity claim",
      "severity": "medium"
    },
    {
      "selector": "#popup-modal",
      "reason": "Intrusive subscription popup",
      "severity": "low"
    }
  ]
}
```

### CSS Selector Requirements

AI should provide **specific, valid CSS selectors**:
- ✅ `.countdown-timer` (class)
- ✅ `#promo-banner` (ID)
- ✅ `button[class*="urgency"]` (attribute)
- ✅ `.product-card .fake-reviews` (nested)
- ❌ `"the red button"` (natural language - won't work!)

## Testing Instructions

### Current Testing (Mock Data)
1. Build: `npm run build`
2. Load extension in Chrome
3. Visit any e-commerce site
4. Click "Analyze This Page"
5. Click "Show Highlights" button
6. Should see mock annotations on:
   - Countdown timers
   - Scarcity warnings
   - Popup modals

### Post-TG-07 Integration Testing
1. Visit sites with known dark patterns
2. Run analysis with AI enabled
3. Check that `analysisResult.elements` contains CSS selectors
4. Click "Show Highlights"
5. Verify elements are correctly highlighted
6. Check tooltips show correct reasons
7. Verify color-coding matches severity
8. Test scroll/resize behavior
9. Test "Hide Highlights" clears all annotations

## File Summary

### Modified Files
| File | Changes | Lines Changed |
|------|---------|---------------|
| `src/content/annotator.ts` | **NEW** - Complete annotation system | 216 lines |
| `src/content/content.ts` | Added annotation handlers | +10 lines |
| `src/popup/App.tsx` | Added toggle button & handler | +50 lines |

### Integration Points (TODO Comments)
All integration points are marked with:
```typescript
// TODO [TG-07 Integration]: <description>
```

Search for `TODO [TG-07` to find all integration points.

## Acceptance Criteria Status

- [x] **A styled overlay is correctly drawn around each manipulative element on the page**
  - ✅ Implemented with color-coded borders, backgrounds, and tooltips
  - ✅ Supports all severity levels (low/medium/high/critical)
  - ✅ Position tracking on scroll/resize

- [x] **The highlights are cleared and redrawn on each new analysis**
  - ✅ `clearAnnotations()` removes all highlights
  - ✅ Smooth fade-out animations
  - ✅ New highlights replace old ones

## Known Limitations

1. **Requires Valid CSS Selectors**: If AI provides invalid selectors, annotation will fail gracefully
2. **Position Tracking Performance**: Updates on scroll with 100ms debounce (may need tuning)
3. **Z-Index Conflicts**: Uses `z-index: 9998/9999` - may conflict with site's modals

## Follow-up PR Checklist

When merging TG-07, the follow-up PR should:

- [ ] Update `AnalysisResult` type to include `elements` array
- [ ] Modify AI service to return CSS selectors in `RiskSignal.details`
- [ ] Update `handleAnalyzePage` to aggregate elements
- [ ] Replace mock data call in `handleToggleAnnotations`
- [ ] Test on 5+ real e-commerce sites
- [ ] Remove `MOCK_ANNOTATIONS` (optional cleanup)
- [ ] Update this guide with any discovered issues

## Questions?

Contact: Mid-level Engineer 1 (TG-09 Owner)

---

**Last Updated**: October 11, 2025  
**Status**: ✅ Complete - Awaiting TG-07 Integration
