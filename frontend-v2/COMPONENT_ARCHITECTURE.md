# Component Architecture for Frontend V2

## Core Design Principles

1. **Modular Components**: Each component is self-contained and reusable
2. **Progressive Enhancement**: Basic functionality works without JavaScript
3. **Data-Driven**: Components receive data and render accordingly
4. **Accessibility First**: All components meet WCAG guidelines

## Component Hierarchy

### 1. Layout Components

#### Header Component
- **File**: `js/components/header.js`
- **Purpose**: Global navigation and search
- **Dependencies**: Search component
- **Data**: User profile, search state

#### Footer Component  
- **File**: `js/components/footer.js`
- **Purpose**: Static footer links
- **Dependencies**: None

#### Modal Component
- **File**: `js/components/modal.js`
- **Purpose**: Reusable modal container
- **Dependencies**: None
- **Usage**: Onboarding, bill details, member profiles

### 2. Dashboard Components

#### CongressionalFeed Component
- **File**: `js/components/feed.js`
- **Purpose**: Renders list of congressional action cards
- **Dependencies**: CardComponent
- **Data**: Array of congressional actions
- **Methods**: `render()`, `addCard()`, `updateCard()`

#### CardComponent
- **File**: `js/components/card.js`
- **Purpose**: Individual congressional action display
- **Props**: 
  - `legislator` (object): Photo, name, party
  - `action` (string): "sponsored", "voted", etc.
  - `bill` (object): Number, title, summary
  - `timestamp` (string): Relative time
- **Methods**: `render()`, `onClick()`

#### SidebarModule Component
- **File**: `js/components/sidebar.js`
- **Purpose**: Container for sidebar sections
- **Props**: `title`, `content`, `type`
- **Variants**: MyMembers, NationalSpotlight, ExploreTopics

### 3. Search Components

#### UniversalSearch Component
- **File**: `js/components/search.js`
- **Purpose**: Autocomplete search functionality
- **Dependencies**: API service
- **States**: empty, typing, results, selected
- **Methods**: `onInput()`, `showDropdown()`, `selectResult()`

#### SearchDropdown Component
- **File**: `js/components/search-dropdown.js`
- **Purpose**: Categorized search results display
- **Props**: `results` (array), `categories` (array)
- **Categories**: Bills, Members, Topics

### 4. Bill Components

#### BillPage Component
- **File**: `js/components/bill-page.js`
- **Purpose**: Complete bill details page
- **Dependencies**: StatusTracker, TabbedContainer, ChatModule
- **Sections**: Header, Status, Chat, Details

#### StatusTracker Component
- **File**: `js/components/status-tracker.js`
- **Purpose**: Visual bill progress stepper
- **Props**: `currentStatus`, `allStatuses`
- **States**: Introduced → Committee → House → Senate → President → Law

#### TabbedContainer Component
- **File**: `js/components/tabbed-container.js`
- **Purpose**: Reusable tabbed interface
- **Props**: `tabs` (array), `defaultTab` (string)
- **Methods**: `switchTab()`, `addTab()`, `removeTab()`

### 5. Interactive Components

#### ChatModule Component
- **File**: `js/components/chat-module.js`
- **Purpose**: Enhanced bill chat interface
- **Dependencies**: PerspectiveButtons, ChatWindow
- **Features**: Context-aware suggestions, follow-ups

#### PerspectiveButtons Component
- **File**: `js/components/perspective-buttons.js`
- **Purpose**: Optimist/Skeptic analysis triggers
- **Props**: `billId`, `perspectives`
- **Events**: `onPerspectiveClick()`

#### ChatWindow Component
- **File**: `js/components/chat-window.js`
- **Purpose**: Chat message display and input
- **Dependencies**: Chat API service
- **Features**: Typing indicators, message history

### 6. Member Components

#### MemberProfile Component
- **File**: `js/components/member-profile.js`
- **Purpose**: Complete member profile page
- **Dependencies**: TabbedContainer, CardComponent
- **Sections**: Header, Stats, Activity tabs

#### MemberCard Component
- **File**: `js/components/member-card.js`
- **Purpose**: Representative display card
- **Props**: `member` (object), `size` (small/large)
- **Usage**: Sidebar, profile pages

### 7. Utility Components

#### LoadingSpinner Component
- **File**: `js/components/loading.js`
- **Purpose**: Loading state indicator
- **Props**: `size`, `message`

#### ErrorMessage Component
- **File**: `js/components/error.js`
- **Purpose**: Error state display
- **Props**: `error`, `retry` (function)

#### TooltipComponent
- **File**: `js/components/tooltip.js`
- **Purpose**: Contextual help text
- **Props**: `text`, `position`

## Data Flow Architecture

### State Management
- **Central State**: `js/state.js` (existing)
- **Local State**: Component-level state for UI interactions
- **Data Cache**: `js/data-manager.js` (existing)

### API Integration
- **Service Layer**: `js/api-service.js` (existing)
- **Chat Service**: `js/chat-api-service.js` (existing)
- **Data Transformation**: Components transform API data for display

### Event System
```javascript
// Event types
const EVENTS = {
  BILL_SELECTED: 'bill:selected',
  MEMBER_SELECTED: 'member:selected',
  SEARCH_QUERY: 'search:query',
  LOCATION_SET: 'location:set',
  PERSPECTIVE_REQUESTED: 'perspective:requested'
};

// Event bus (simple implementation)
class EventBus {
  constructor() {
    this.listeners = {};
  }
  
  on(event, callback) { /* ... */ }
  emit(event, data) { /* ... */ }
  off(event, callback) { /* ... */ }
}
```

## File Organization

```
frontend-v2/
├── js/
│   ├── components/
│   │   ├── card.js
│   │   ├── chat-module.js
│   │   ├── chat-window.js
│   │   ├── error.js
│   │   ├── feed.js
│   │   ├── header.js
│   │   ├── loading.js
│   │   ├── member-card.js
│   │   ├── member-profile.js
│   │   ├── modal.js
│   │   ├── perspective-buttons.js
│   │   ├── search.js
│   │   ├── sidebar.js
│   │   ├── status-tracker.js
│   │   ├── tabbed-container.js
│   │   └── tooltip.js
│   ├── pages/
│   │   ├── dashboard.js
│   │   ├── bill-page.js
│   │   └── member-page.js
│   ├── utils/
│   │   ├── events.js
│   │   ├── dom.js
│   │   └── formatting.js
│   └── [existing service files]
```

## Component Communication

### Parent → Child (Props)
```javascript
const card = new CardComponent({
  legislator: legislatorData,
  bill: billData,
  action: 'sponsored',
  timestamp: '2 days ago'
});
```

### Child → Parent (Events)
```javascript
// Child emits event
this.emit('card:clicked', { billId: this.props.bill.id });

// Parent listens
feed.on('card:clicked', (data) => {
  navigateToBill(data.billId);
});
```

### Cross-Component (Event Bus)
```javascript
// Component A
EventBus.emit('bill:selected', { billId: 'HR123' });

// Component B
EventBus.on('bill:selected', (data) => {
  this.highlightBill(data.billId);
});
```

## Rendering Strategy

### Server-Side Friendly
- Each component can render to HTML string
- Progressive enhancement adds interactivity
- No framework dependencies

### Client-Side Optimization
- Virtual DOM-like diffing for updates
- Event delegation for performance
- Lazy loading for non-critical components

### Example Component Structure
```javascript
class CardComponent {
  constructor(props) {
    this.props = props;
    this.element = null;
  }
  
  render() {
    const html = this.template();
    this.element = this.createElement(html);
    this.bindEvents();
    return this.element;
  }
  
  template() {
    return `
      <div class="congressional-card" data-bill-id="${this.props.bill.id}">
        <!-- component HTML -->
      </div>
    `;
  }
  
  bindEvents() {
    this.element.addEventListener('click', this.onClick.bind(this));
  }
  
  onClick() {
    this.emit('card:clicked', { billId: this.props.bill.id });
  }
  
  update(newProps) {
    this.props = { ...this.props, ...newProps };
    this.element.outerHTML = this.template();
  }
}
```

This architecture provides a solid foundation for implementing the NEW_FRONTEND.md design while maintaining clean separation of concerns and reusability.