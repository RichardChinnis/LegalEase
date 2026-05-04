# Header Components

This document describes the implementation of the Header component system with universal search functionality, following the NEW_FRONTEND.md specifications.

## Components Overview

### 1. Header Component (`header.js`)
The main header component that provides the primary navigation and branding for the application.

**Features:**
- Clean, single-row layout as specified in NEW_FRONTEND.md
- Logo that links back to the main Dashboard
- Universal search bar integration
- User profile icon with hover effects
- Responsive mobile design with hamburger menu
- Sticky positioning for consistent navigation
- Accessibility compliance (ARIA labels, keyboard navigation)

**Props:**
- `logoText` (string): Text to display next to the logo (default: "Congress Tracker")
- `logoHref` (string): URL for the logo link (default: "/")
- `showUserProfile` (boolean): Whether to show the user profile icon (default: true)

**Events Emitted:**
- `user:profile-click`: When the user profile icon is clicked
- Forwards search events from the search component

### 2. Search Component (`search.js`)
Universal search component with autocomplete, keyboard navigation, and API integration.

**Features:**
- Placeholder text as specified: "Search for bills (e.g., 'H.R. 5376'), members, or topics..."
- Debounced search with configurable delay (default: 300ms)
- Autocomplete dropdown with categorized results
- Keyboard navigation support (arrow keys, Enter, Escape)
- Recent searches stored in localStorage
- Loading states and error handling
- Search result caching for performance
- Clear button when query is present
- Integration with Congress API endpoints

**Props:**
- `placeholder` (string): Input placeholder text
- `debounceMs` (number): Debounce delay for search API calls (default: 300)
- `minQueryLength` (number): Minimum characters before searching (default: 2)
- `maxResults` (number): Maximum results to display (default: 10)
- `showClearButton` (boolean): Whether to show the clear button (default: true)
- `autoFocus` (boolean): Whether to auto-focus the input (default: false)

**Events Emitted:**
- `search:select`: When a search result is selected
- `search:general`: When Enter is pressed without selecting a specific result

**API Integration:**
- Bills: `/api/bill?q={query}&limit=5`
- Members: `/api/member?q={query}&limit=3`
- Topics: Built-in topic matching (extensible for API integration)

### 3. SearchDropdown Component (`search-dropdown.js`)
Displays categorized search results with proper accessibility and visual hierarchy.

**Features:**
- Categorized results: Bills, Members, Topics, Recent Searches
- Icons and member avatars for visual distinction
- Query highlighting in results
- Keyboard navigation coordination with parent
- Loading states and empty states
- Search tips for better user experience
- Responsive design for mobile devices
- Proper ARIA roles and labels

**Props:**
- `results` (array): Search results to display
- `isLoading` (boolean): Loading state
- `isOpen` (boolean): Dropdown visibility
- `selectedIndex` (number): Currently selected result index
- `query` (string): Current search query for highlighting
- `onSelect` (function): Callback when result is selected
- `onClose` (function): Callback when dropdown should close

## Design System Integration

### Color Scheme
Following NEW_FRONTEND.md specifications:
- **Primary Color**: `#005F73` (Deep Teal) - Used for interactive elements
- **Neutral Backgrounds**: `#F8F9FA` (Very Light Grey) - Softer than pure white
- **Text Colors**: `#212529` (Charcoal) - Easier on eyes than pure black
- **Partisan Colors**: Only used for party identification, not UI elements

### Typography
- **Headings**: Montserrat/Poppins for modern, authoritative feel
- **Body Text**: Inter for optimal UI readability
- **Clear Hierarchy**: Established type scale for consistent information flow

### Visual Design
- **Rounded Corners**: 4-8px radius for modern, approachable feel
- **Generous Whitespace**: Prevents anxiety, makes information digestible
- **Consistent Icons**: Outline style using Feather Icons approach
- **Smooth Transitions**: 200ms base transition for polished interactions

## Responsive Behavior

### Mobile Layout (≤768px)
- Logo text hidden on mobile to save space
- Hamburger menu toggle appears
- Search and profile sections stack vertically
- Mobile overlay for expanded search
- Touch-optimized hit targets (44px minimum)
- Dropdown adjusts to 60vh maximum height

### Tablet Layout (769px-1024px)
- All elements visible in single row
- Search bar maintains prominence
- Comfortable spacing maintained

### Desktop Layout (≥1025px)
- Full header with maximum 1200px container width
- Search bar can expand to 600px maximum
- Optimal spacing between all elements

## Accessibility Features

### Keyboard Navigation
- **Tab**: Navigate between header elements
- **Arrow Keys**: Navigate search results
- **Enter**: Select search result or submit general search
- **Escape**: Close search dropdown
- **Ctrl/Cmd+K**: Focus search input (demo feature)

### Screen Reader Support
- Proper ARIA roles and labels
- Screen reader-only help text for search usage
- Semantic HTML structure
- Focus management for dropdown interactions

### Visual Accessibility
- High contrast ratios meeting WCAG guidelines
- Focus indicators with 2px outline offset
- Clear visual hierarchy with proper heading levels
- Sufficient touch target sizes (44px minimum)

## Performance Optimizations

### Search Performance
- **Debounced Requests**: Prevents API spam during typing
- **Request Cancellation**: Aborts previous requests when new ones start
- **Result Caching**: Caches up to 50 recent search results
- **Efficient DOM Updates**: Uses shallow comparison to prevent unnecessary re-renders

### Component Performance
- **BaseComponent Architecture**: Provides optimized lifecycle management
- **Event Delegation**: Efficient event handling with automatic cleanup
- **Lazy Loading**: Search dropdown only renders when needed
- **Memory Management**: Proper cleanup on component destruction

## Usage Examples

### Basic Header
```javascript
const header = new Header({
    logoText: 'Congress Tracker',
    logoHref: '/',
    showUserProfile: true
});

header.mount('#header-container');
```

### Standalone Search
```javascript
const search = new Search({
    placeholder: 'Search congress data...',
    autoFocus: true,
    maxResults: 15
});

search.on('search:select', (data) => {
    console.log('Selected:', data.type, data.item);
});

search.mount('#search-container');
```

### Event Handling
```javascript
// Listen for search selections
EventBus.on('search:select', (data) => {
    const { type, item } = data;
    switch (type) {
        case 'bill':
            navigateTo(`/bill/${item.number}`);
            break;
        case 'member':
            navigateTo(`/member/${item.bioguideId}`);
            break;
        case 'topic':
            navigateTo(`/topic/${item.id}`);
            break;
    }
});

// Listen for user profile clicks
EventBus.on('user:profile-click', () => {
    showUserMenu();
});
```

## Testing

### Demo Page
Use `header-demo.html` to test the header components:
1. Open in browser to see visual layout
2. Test search functionality with different queries
3. Try keyboard navigation
4. Test responsive behavior by resizing window
5. Check accessibility with screen reader

### Search Testing Scenarios
1. **Bill Search**: "H.R. 1234", "S. 567", "healthcare bill"
2. **Member Search**: "Smith", "John", "California"
3. **Topic Search**: "healthcare", "environment", "economy"
4. **Edge Cases**: Empty queries, special characters, long queries
5. **Keyboard Navigation**: Arrow keys, Enter, Escape
6. **Mobile Testing**: Touch interactions, responsive layout

## Browser Support

- **Modern Browsers**: Chrome 88+, Firefox 85+, Safari 14+, Edge 88+
- **Mobile Browsers**: iOS Safari 14+, Chrome Mobile 88+
- **Features Used**: 
  - CSS Grid and Flexbox
  - ES6 Classes and Modules
  - Fetch API with AbortController
  - localStorage API
  - CSS Custom Properties

## File Structure
```
frontend-v2/js/components/
├── header.js              # Main header component
├── search.js              # Universal search component  
├── search-dropdown.js     # Search results dropdown
└── base-component.js      # Base component class

frontend-v2/css/
├── base.css               # Variables and reset
├── components.css         # Component styles (including header)
└── layout.css             # Layout utilities

frontend-v2/
├── header-demo.html       # Demo and testing page
└── HEADER_COMPONENTS.md   # This documentation
```

## Future Enhancements

1. **Advanced Search Features**
   - Search filters (date range, chamber, status)
   - Search suggestions based on trending topics
   - Voice search integration
   - Search analytics

2. **User Experience**
   - Search shortcuts and power user features
   - Customizable recent searches
   - Search result previews
   - Saved searches functionality

3. **Performance**
   - Service worker caching for search results
   - Search result prefetching
   - Virtual scrolling for large result sets
   - Search analytics and optimization

4. **Integration**
   - Deep linking for search queries
   - Search state persistence across navigation
   - Integration with browser history
   - Search SEO optimization