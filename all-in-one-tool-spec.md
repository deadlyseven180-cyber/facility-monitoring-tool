# All-in-One Company Data Tool

## Overview
This project is a single web-based dashboard designed to eliminate the need for multiple tabs and tools. It centralizes data workflows into one clean interface.

The tool focuses on two core functions:
1. Gathering a single CSV report
2. Comparing two CSV datasets

---

## Tech Stack (Recommended)
- React or Next.js (preferred)
- PapaParse (CSV parsing)
- Tailwind CSS or similar for styling
- State management: useState / Context API (simple setup)

---

## UI Layout

### Sidebar (Left Navigation)
- One main tab:
  - **Gather Data**

When clicked, it loads the main workspace.

---

## Main Workspace (Gather Data Page)

When the user clicks "Gather Data", show two main action cards:

### 1. Gather One Report
### 2. Compare Data

---

## Feature 1: Gather One Report

### Functionality:
- Display a file upload component
- Accept only `.csv` files
- Allow drag and drop or manual upload

### After Upload:
- Parse the CSV file
- Display data in a clean table preview
- Show:
  - Column headers
  - First 10–50 rows (for preview)
- Include loading state while parsing
- Include error handling for invalid files

---

## Feature 2: Compare Data

### Functionality:
- Display two separate file upload inputs:
  - **Data 1**
  - **Data 2**

### Requirements:
- Only accept `.csv` files
- Both files must be uploaded before enabling comparison

### Button Behavior:
- "Compare Data" button is disabled until:
  - Data 1 is uploaded AND
  - Data 2 is uploaded

### After Clicking Compare:
- Parse both CSV files
- Compare datasets

### Output Should Include:
- Matching rows
- Differences (rows only in Data 1 vs only in Data 2)
- Summary statistics:
  - Total rows in Data 1
  - Total rows in Data 2
  - Number of matches
  - Number of differences

---

## UI/UX Requirements

- Clean SaaS-style dashboard design
- Responsive layout (desktop-first but mobile friendly)
- Use card-based layout for actions
- Clear spacing and typography
- Loading indicators for file processing
- Friendly error messages for invalid CSV uploads
- Simple icons for navigation and actions

---

## Future Expansion (Important Design Note)

Structure the project so it can easily scale into more tools under the same sidebar system.

Future modules may include:
- Refund processing tool
- Inventory tracker
- Reporting automation
- Email notification system
- API integrations (e.g., SpotHero data tools)

---

## Architecture Notes

- Keep components modular:
  - Sidebar component
  - Dashboard layout
  - Upload component (reusable)
  - CSV parser utility
  - Comparison engine module

- Avoid tightly coupling logic to UI

---

## Success Criteria

The tool is successful if:
- Users can complete both workflows without leaving the page
- CSV upload + parsing works reliably
- Comparison output is clear and actionable
- UI is simple enough for non-technical staff