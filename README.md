# Urban Waste Exchange

Urban Waste Exchange is a real-time marketplace for recyclable waste. Households and businesses can list segregated waste, and local recyclers can filter, claim, complete pickups, plan collection routes, and reopen saved route history from a live feed.

## MVP Features

- Seller listing flow with title, material type, weight, locality, notes, photo upload, and exact coordinates
- Recycler dashboard with live filters for material family, locality, search, status, and nearby radius
- Role-based signup and login for sellers and recyclers
- JWT-protected listing creation, claiming, pickup completion, traditional payment recording, route planning, and saved route history
- Real-time updates powered by Socket.IO for newly created and updated listings
- MongoDB persistence with automatic first-run seed data
- Geospatial indexing and proximity-ready API queries
- Interactive map visualization for listings and recycler location
- Reverse geocoding to turn captured coordinates into readable place names and persist them with listings
- Recycler route optimization for nearby pickups and assigned claims
- Saved route history so recyclers can reopen recent plans without recalculating from scratch
- Named favorite route templates for repeat pickup circuits

## Tech Stack

- React 19 + Vite
- Express
- MongoDB + Mongoose
- JWT + bcryptjs authentication
- Socket.IO
- React Leaflet + Leaflet
- Plain CSS with a custom visual theme

## Environment Setup

Create a `.env` file from `.env.example` and set your values:

```bash
MONGO_URI=mongodb://127.0.0.1:27017/urban_waste_exchange
PORT=4000
JWT_SECRET=replace-with-a-long-random-secret
GEOCODER_USER_AGENT=urban-waste-exchange-demo/1.0
FRONTEND_ORIGINS=http://localhost:5173
VITE_API_BASE_URL=
VITE_SOCKET_URL=
```

You can also use MongoDB Atlas by replacing `MONGO_URI` with your cluster connection string.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the frontend and backend together:

```bash
npm run dev
```

The app expects:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000`
- MongoDB: available through `MONGO_URI`

For local development, leave `VITE_API_BASE_URL` and `VITE_SOCKET_URL` empty so Vite can proxy `/api` and `/socket.io` to the backend.

Build for production:

```bash
npm run build
```

Start only the backend API:

```bash
npm start
```

## Authentication Flow

- Register as either a `seller` or a `recycler`
- Sellers can create listings from their authenticated account
- Recyclers can claim listings and only the recycler who claimed a listing can mark it completed
- The frontend stores the JWT in local storage for the current session

## Geolocation And Route Flow

- Sellers can enter latitude and longitude manually or use the browser geolocation button in the listing form
- Captured seller coordinates are reverse-geocoded through the backend to auto-fill and persist locality, city, and a human-readable address label
- Listings are stored with both a `coordinates` object and a MongoDB GeoJSON point for geospatial indexing
- Recyclers can capture their current location and turn on nearby-only mode with a chosen radius
- The app shows listings and recycler position on an interactive OpenStreetMap-based map
- The API supports geospatial filtering with query parameters such as `lat`, `lng`, and `radiusKm`
- Recyclers can generate an optimized pickup sequence from their current coordinates using nearby available listings plus any claimed pickups assigned to them
- Each generated route is saved in MongoDB and can be reopened from the recycler dashboard later
- Recyclers can mark any saved route as a named favorite template for one-click reuse

Example proximity query:

```bash
GET /api/listings?lat=12.9352&lng=77.6245&radiusKm=5&status=available
```

## API Endpoints

- `POST /api/auth/register` creates a seller or recycler account
- `POST /api/auth/login` signs in and returns a JWT
- `GET /api/auth/me` returns the current authenticated user
- `GET /api/meta` returns material metadata and estimated rate cards
- `GET /api/notifications/my` returns the signed-in user's latest notifications
- `PATCH /api/notifications/:id/read` marks a notification as read
- `GET /api/listings` returns the live marketplace feed from MongoDB
- `GET /api/listings?lat=...&lng=...&radiusKm=...` returns listings filtered by proximity
- `POST /api/listings` creates a new waste listing with geolocation for authenticated sellers
- `GET /api/routes/my` returns the signed-in recycler's recent saved routes
- `PATCH /api/routes/:id/favorite` names or removes a recycler's favorite route template
- `POST /api/routes/optimize` builds and saves a recycler route from a start point and the current route-ready listings
- `PATCH /api/listings/:id/claim` marks a listing as claimed by the authenticated recycler
- `PATCH /api/listings/:id/complete` marks a claimed listing as picked up by the same recycler
- `PATCH /api/listings/:id/transaction` records an offline transaction such as cash, bank transfer, or cheque for the assigned recycler
- `PATCH /api/listings/:id/transaction/confirm` lets the seller confirm receipt after a payment is marked paid
- `GET /api/listings/:id/receipt` downloads a plain-text settlement receipt for the seller, assigned recycler, or admin

## Deployment Notes

- On Render, set `FRONTEND_ORIGINS` to a comma-separated allowlist such as `http://localhost:5173,https://your-site.netlify.app`
- On Netlify, set `VITE_API_BASE_URL` to your Render backend URL, for example `https://urban-waste-exchange.onrender.com`
- If you want Socket.IO to use a different host, set `VITE_SOCKET_URL`; otherwise it reuses `VITE_API_BASE_URL`

## Next Enhancements

- Add backend caching for reverse-geocoding responses
- Add export or share links for route templates
- Integrate AI waste recognition from uploaded images
- Add printable PDF receipts or invoice branding
- Add admin moderation and reporting tools

## Admin And AI Features

- Admin accounts can open a moderation dashboard with platform metrics, recent users, recent listings, and favorite recycler routes
- Admins can approve, flag, or reject listings and attach moderation notes
- Sellers can upload a waste photo and request AI-assisted material suggestions before publishing
- New listings can persist the AI suggestion metadata alongside the listing record for admin review

## Additional API Endpoints

- `POST /api/classify-waste` runs the waste classification helper for authenticated sellers or admins
- `GET /api/admin/overview` returns admin metrics, recent users, recent listings, and favorite routes
- `PATCH /api/admin/listings/:id/moderate` updates listing moderation status and admin notes


## Traditional Transaction Flow

- Once a recycler claims and completes a pickup, the listing moves into pending settlement
- The assigned recycler can record an offline payment using cash, bank transfer, or cheque
- Each listing stores the agreed amount, settlement status, notes, who recorded the payment, when the seller confirmed receipt, and supports downloadable receipts

## Notifications

- Authenticated users now get an in-app notification inbox for important workflow events
- Sellers are notified when listings are claimed, pickups are completed, payments are recorded, and moderation changes happen
- Recyclers are notified when sellers confirm payment receipt
- Notifications can be marked as read from the dashboard
