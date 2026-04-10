import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import MarketplaceMap from './components/MarketplaceMap.jsx'
import './App.css'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || API_BASE_URL).replace(/\/$/, '')

const fallbackMaterials = [
  { name: 'PET Plastic', family: 'Plastic', ratePerKg: 18 },
  { name: 'HDPE Plastic', family: 'Plastic', ratePerKg: 24 },
  { name: 'Cardboard', family: 'Paper', ratePerKg: 12 },
  { name: 'Newspaper', family: 'Paper', ratePerKg: 10 },
  { name: 'Aluminum', family: 'Metal', ratePerKg: 95 },
  { name: 'Steel', family: 'Metal', ratePerKg: 28 },
  { name: 'Copper', family: 'Metal', ratePerKg: 620 },
  { name: 'Mixed E-Waste', family: 'E-Waste', ratePerKg: 55 },
]

const emptyListingForm = {
  title: '',
  material: fallbackMaterials[0].name,
  weightKg: '',
  locality: '',
  city: 'Bengaluru',
  imageUrl: '',
  notes: '',
  coordinates: { lat: '', lng: '' },
}

const emptyAuthForm = {
  name: '',
  email: '',
  phone: '',
  password: '',
  role: 'seller',
}

const defaultFilters = {
  search: '',
  family: 'All',
  locality: 'All',
  availability: 'All',
  nearbyOnly: false,
  radiusKm: '10',
}

const socket = io(SOCKET_URL || undefined, { autoConnect: false })

function apiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

function formatTime(value) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function calculateDistanceKm(from, to) {
  if (!from || !to || to.lat == null || to.lng == null) return null
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Number((2 * 6371 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))).toFixed(2))
}

function formatDistance(distanceKm) {
  return distanceKm == null ? 'Location unavailable' : `${distanceKm.toFixed(1)} km away`
}

function formatTransactionLabel(value) {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function isValidPhone(value) {
  return /^\d{10}$/.test(String(value || '').trim())
}

function isValidCoordinate(lat, lng) {
  const parsedLat = Number(lat)
  const parsedLng = Number(lng)
  return Number.isFinite(parsedLat) && Number.isFinite(parsedLng) && parsedLat >= -90 && parsedLat <= 90 && parsedLng >= -180 && parsedLng <= 180
}

function validateAuthForm(authMode, authForm) {
  if (!isValidEmail(authForm.email)) return 'Enter a valid email address.'
  if (authMode === 'register') {
    if ((authForm.password || '').length < 6) return 'Password must be at least 6 characters long.'
    if ((authForm.name || '').trim().length < 3) return 'Full name must be at least 3 characters long.'
    if (!isValidPhone(authForm.phone)) return 'Enter a valid 10-digit phone number.'
  }
  return ''
}

function validateListingForm(listingForm) {
  if ((listingForm.title || '').trim().length < 5) return 'Listing title must be at least 5 characters long.'
  if (!Number.isFinite(Number(listingForm.weightKg)) || Number(listingForm.weightKg) <= 0) return 'Weight must be greater than 0 kg.'
  if (!isValidCoordinate(listingForm.coordinates?.lat, listingForm.coordinates?.lng)) return 'Enter valid latitude and longitude values before publishing.'
  return ''
}

async function reverseGeocode(lat, lng) {
  const response = await fetch(apiUrl(`/api/geocode/reverse?lat=${lat}&lng=${lng}`))
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message || 'Reverse geocoding failed.')
  return payload
}

function getDashboardPath(role) {
  if (role === 'seller') return '/seller'
  if (role === 'recycler') return '/recycler'
  if (role === 'admin') return '/admin'
  return '/'
}

function RoleGuard({ currentUser, role, children }) {
  if (!currentUser) return <Navigate to="/auth" replace />
  if (role && currentUser.role !== role) return <Navigate to={getDashboardPath(currentUser.role)} replace />
  return children
}

function PublicHome({ currentUser, summary, statusMessage, unreadNotifications, filteredListings }) {
  return (
    <>
      <section className="hero-panel">
        <article className="hero-copy">
          <span className="eyebrow">Circular Marketplace</span>
          <h1>Urban Waste Exchange</h1>
          <p className="hero-text">
            Connect households, businesses, recyclers, and administrators through one live waste-to-wealth marketplace built for urban circular economies.
          </p>
          <div className="hero-stats">
            <article><strong>{summary.total}</strong><span>Total listings</span></article>
            <article><strong>{summary.available}</strong><span>Available pickups</span></article>
            <article><strong>{summary.claimed}</strong><span>Claimed pickups</span></article>
          </div>
        </article>
        <article className="impact-card">
          <span className="section-kicker">Platform status</span>
          <h2>Live and role-aware</h2>
          <p className="helper-line">
            {currentUser ? `Signed in as ${currentUser.name}. Use the navigation to enter your ${currentUser.role} workspace.` : 'Create an account as a seller, recycler, or admin to unlock the right workspace automatically.'}
          </p>
          <ul>
            <li>{statusMessage}</li>
            <li>{summary.geoTagged} geo-tagged listings currently visible</li>
            <li>{unreadNotifications} unread notifications in the latest session</li>
          </ul>
        </article>
      </section>

      <section className="feed-section">
        <div className="feed-header">
          <div>
            <span className="section-kicker">Marketplace snapshot</span>
            <h2>Recent recyclable listings</h2>
            <p>Browse the live feed, then sign in for seller, recycler, or admin controls.</p>
          </div>
          <span className="status-pill">{Math.min(filteredListings.length, 6)} cards shown</span>
        </div>
        <div className="listing-grid">
          {filteredListings.slice(0, 6).map((listing) => (
            <article key={listing.id} className="listing-card">
              <img src={listing.imageUrl} alt={listing.title} />
              <div className="listing-body">
                <div className="card-topline">
                  <span className={`status-tag ${listing.status}`}>{listing.status}</span>
                  <span className={`status-tag moderation-${listing.moderationStatus}`}>{listing.moderationStatus}</span>
                  <span>{formatTime(listing.createdAt)}</span>
                </div>
                <h3>{listing.title}</h3>
                <p className="location-line">{listing.addressLabel || `${listing.locality}, ${listing.city}`}</p>
                <div className="listing-metrics">
                  <span>{listing.material}</span>
                  <span>{listing.weightKg} kg</span>
                  <span>{formatCurrency(listing.estimatedValue)}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

function AuthPage({ authMode, authForm, setAuthForm, setAuthMode, handleAuthSubmit, authSubmitting, authStatus, currentUser, handleLogout }) {
  return (
    <section className="auth-page-grid">
      <article className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Access</span>
            <h2>{currentUser ? 'Your account' : 'Sign in or create an account'}</h2>
          </div>
          {authStatus ? <span className="status-pill">{authStatus}</span> : null}
        </div>
        {currentUser ? (
          <div className="session-card">
            <strong>{currentUser.name}</strong>
            <span>{currentUser.email}</span>
            <span>{currentUser.phone}</span>
            <span>Role: {currentUser.role}</span>
            <button type="button" className="ghost-button" onClick={handleLogout}>Sign out</button>
          </div>
        ) : (
          <>
            <div className="auth-toggle">
              <button type="button" className={authMode === 'login' ? 'primary-button compact-button' : 'ghost-button compact-button'} onClick={() => setAuthMode('login')}>Login</button>
              <button type="button" className={authMode === 'register' ? 'primary-button compact-button' : 'ghost-button compact-button'} onClick={() => setAuthMode('register')}>Register</button>
            </div>
            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {authMode === 'register' ? (
                <div className="form-grid compact">
                  <label>Full name<input value={authForm.name} onChange={(event) => setAuthForm((current) => ({ ...current, name: event.target.value }))} required /></label>
                  <label>Phone<input value={authForm.phone} onChange={(event) => setAuthForm((current) => ({ ...current, phone: event.target.value }))} required /></label>
                  <label className="full-span">Role<select value={authForm.role} onChange={(event) => setAuthForm((current) => ({ ...current, role: event.target.value }))}><option value="seller">Seller</option><option value="recycler">Recycler</option><option value="admin">Admin</option></select></label>
                </div>
              ) : null}
              <label>Email<input type="email" value={authForm.email} onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))} required /></label>
              <label>Password<input type="password" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} required /></label>
              <button className="primary-button" type="submit" disabled={authSubmitting}>{authSubmitting ? 'Working...' : authMode === 'login' ? 'Sign in' : 'Create account'}</button>
            </form>
          </>
        )}
      </article>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Role routing</span>
            <h2>Different workspace for each role</h2>
          </div>
        </div>
        <div className="role-card-list">
          <div className="role-card"><strong>Seller</strong><span>Publish listings, geo-tag waste, and confirm receipts.</span></div>
          <div className="role-card"><strong>Recycler</strong><span>Filter nearby pickups, claim materials, plan routes, and record payments.</span></div>
          <div className="role-card"><strong>Admin</strong><span>Moderate listings, review platform metrics, and monitor route activity.</span></div>
        </div>
      </article>
    </section>
  )
}

function NotificationsPanel({ notifications, notificationsLoading, unreadNotifications, handleMarkNotificationRead, handleMarkAllNotificationsRead }) {
  return (
    <section className="panel notification-panel">
      <div className="panel-heading">
        <div><span className="section-kicker">Inbox</span><h2>Notifications</h2></div>
        <div className="panel-heading-actions">
          <span className="status-pill">{notificationsLoading ? 'Loading...' : `${unreadNotifications} unread`}</span>
          {unreadNotifications ? <button type="button" className="ghost-button compact-button" onClick={handleMarkAllNotificationsRead}>Mark all read</button> : null}
        </div>
      </div>
      <div className="notification-list">
        {notifications.length ? notifications.map((notification) => (
          <div key={notification.id} className={`notification-card${notification.readAt ? ' notification-read' : ''}`}>
            <div>
              <strong>{notification.title}</strong>
              <span>{notification.message}</span>
              <span className="muted-text">{formatTime(notification.createdAt)}</span>
            </div>
            {!notification.readAt ? <button type="button" className="ghost-button" onClick={() => handleMarkNotificationRead(notification.id)}>Mark read</button> : null}
          </div>
        )) : <p className="muted-text">No notifications yet.</p>}
      </div>
    </section>
  )
}

function SellerActivityPanel({ sellerListings }) {
  const activityItems = sellerListings
    .flatMap((listing) => {
      const events = []
      if (listing.claimedBy?.claimedAt) {
        events.push({
          id: `${listing.id}-claimed`,
          timestamp: listing.claimedBy.claimedAt,
          title: 'Pickup claimed',
          description: `${listing.claimedBy.name} claimed ${listing.title}${listing.claimedBy.pickupTime ? ` for ${formatTime(listing.claimedBy.pickupTime)}` : ''}.`,
        })
      }
      if (listing.status === 'completed') {
        events.push({
          id: `${listing.id}-completed`,
          timestamp: listing.updatedAt || listing.createdAt,
          title: 'Pickup completed',
          description: `${listing.title} has been marked as picked up and is waiting for settlement updates.`,
        })
      }
      if (listing.transaction?.recordedAt) {
        events.push({
          id: `${listing.id}-transaction`,
          timestamp: listing.transaction.recordedAt,
          title: 'Payment recorded',
          description: `${formatCurrency(listing.transaction.amount || 0)} was recorded as ${formatTransactionLabel(listing.transaction.paymentStatus || 'not_started')} for ${listing.title}.`,
        })
      }
      if (listing.transaction?.sellerConfirmedAt) {
        events.push({
          id: `${listing.id}-confirmed`,
          timestamp: listing.transaction.sellerConfirmedAt,
          title: 'Receipt confirmed',
          description: `You confirmed receipt for ${listing.title}.`,
        })
      }
      return events
    })
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    .slice(0, 8)

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><span className="section-kicker">Seller history</span><h2>Recent seller activity</h2></div>
        <span className="status-pill">{activityItems.length} recent events</span>
      </div>
      <div className="notification-list">
        {activityItems.length ? activityItems.map((item) => (
          <div key={item.id} className="notification-card notification-read">
            <div>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
              <span className="muted-text">{formatTime(item.timestamp)}</span>
            </div>
          </div>
        )) : <p className="muted-text">Seller activity will appear here after your listings are claimed or settled.</p>}
      </div>
    </section>
  )
}

function TransactionHistoryPage({ currentUser, transactionHistory, transactionHistoryLoading, handleDownloadReceipt }) {
  return (
    <section className="feed-section">
      <div className="feed-header">
        <div>
          <span className="section-kicker">Settlements</span>
          <h2>Transaction history</h2>
          <p>Review every recorded offline settlement for your current role and download receipts when needed.</p>
        </div>
        <span className="status-pill">{transactionHistoryLoading ? 'Loading...' : `${transactionHistory.length} records`}</span>
      </div>
      <div className="listing-grid">
        {transactionHistory.length ? transactionHistory.map((listing) => (
          <article key={listing.id} className="listing-card transaction-history-card">
            <img src={listing.imageUrl} alt={listing.title} />
            <div className="listing-body">
              <div className="card-topline">
                <span className={`status-tag ${listing.status}`}>{listing.status}</span>
                <span>{formatTime(listing.transaction?.recordedAt || listing.updatedAt || listing.createdAt)}</span>
              </div>
              <h3>{listing.title}</h3>
              <p className="location-line">{listing.addressLabel || `${listing.locality}, ${listing.city}`}</p>
              <div className="listing-metrics">
                <span>{listing.material}</span>
                <span>{formatCurrency(listing.transaction?.amount || 0)}</span>
                <span>{formatTransactionLabel(listing.transaction?.paymentStatus || 'not_started')}</span>
              </div>
              <div className="contact-block seller-detail-block">
                <strong>Settlement details</strong>
                <span>Seller: {listing.sellerName}</span>
                <span>Recycler: {listing.claimedBy?.name || 'Not assigned'}</span>
                <span>Method: {formatTransactionLabel(listing.transaction?.paymentMethod || 'cash')}</span>
                {listing.transaction?.notes ? <span>Notes: {listing.transaction.notes}</span> : null}
                {listing.transaction?.sellerConfirmedAt ? <span>Seller confirmed on {formatTime(listing.transaction.sellerConfirmedAt)}</span> : null}
              </div>
              {currentUser ? <div className="card-actions"><button type="button" className="ghost-button" onClick={() => handleDownloadReceipt(listing)}>Download receipt</button></div> : null}
            </div>
          </article>
        )) : <p className="muted-text">No transaction history yet for this role.</p>}
      </div>
    </section>
  )
}

function ListingFeed({ title, kicker, description, listings, currentUser, activeClaimId, handleClaim, handleComplete, handleRecordTransaction, handleConfirmReceipt, handleDownloadReceipt }) {
  return (
    <section className="feed-section">
      <div className="feed-header">
        <div><span className="section-kicker">{kicker}</span><h2>{title}</h2><p>{description}</p></div>
        <span className="status-pill">{listings.length} cards in view</span>
      </div>
      <div className="listing-grid">
        {listings.map((listing) => {
          const isClaimedByCurrentRecycler = currentUser?.role === 'recycler' && listing.claimedBy?.userId === currentUser.id
          const canClaim = currentUser?.role === 'recycler' && listing.status === 'available' && listing.moderationStatus !== 'rejected'
          const canComplete = currentUser?.role === 'recycler' && listing.status === 'claimed' && isClaimedByCurrentRecycler
          const canRecordTransaction = currentUser?.role === 'recycler' && isClaimedByCurrentRecycler && ['claimed', 'completed'].includes(listing.status)
          const canConfirmReceipt = currentUser?.role === 'seller' && listing.sellerId === currentUser.id && listing.transaction?.paymentStatus === 'paid' && !listing.transaction?.sellerConfirmedAt
          const canDownloadReceipt = Boolean(currentUser) && ((currentUser.role === 'seller' && listing.sellerId === currentUser.id) || (currentUser.role === 'recycler' && isClaimedByCurrentRecycler) || currentUser.role === 'admin') && listing.transaction && (listing.transaction.amount > 0 || listing.transaction.paymentStatus !== 'not_started')
          const showRecyclerSellerDetails = currentUser?.role === 'recycler'
          return (
            <article key={listing.id} className="listing-card">
              <img src={listing.imageUrl} alt={listing.title} />
              <div className="listing-body">
                <div className="card-topline">
                  <span className={`status-tag ${listing.status}`}>{listing.status}</span>
                  <span className={`status-tag moderation-${listing.moderationStatus}`}>{listing.moderationStatus}</span>
                  <span>{formatTime(listing.createdAt)}</span>
                </div>
                <h3>{listing.title}</h3>
                <p className="location-line">{listing.addressLabel || `${listing.locality}, ${listing.city}`}</p>
                <div className="listing-metrics"><span>{listing.material}</span><span>{listing.weightKg} kg</span><span>{formatCurrency(listing.estimatedValue)}</span></div>
                <div className="distance-strip"><span>{listing.family}</span><span>{formatDistance(listing.computedDistanceKm)}</span></div>
                {showRecyclerSellerDetails ? (
                  <div className="contact-block seller-detail-block">
                    <strong>Seller details</strong>
                    <span>{listing.sellerName}</span>
                    <span>{listing.sellerPhone}</span>
                    <span>{listing.addressLabel || `${listing.locality}, ${listing.city}`}</span>
                    {listing.coordinates?.lat != null && listing.coordinates?.lng != null ? <span>{listing.coordinates.lat}, {listing.coordinates.lng}</span> : null}
                  </div>
                ) : null}
                {listing.notes ? <p className="notes">{listing.notes}</p> : null}
                {listing.aiClassification?.suggestedMaterial ? <div className="ai-inline-note"><strong>AI match</strong><span>{listing.aiClassification.suggestedMaterial} | {Math.round((listing.aiClassification.confidence || 0) * 100)}%</span></div> : null}
                {listing.adminNotes ? <div className="ai-inline-note admin-inline-note"><strong>Admin note</strong><span>{listing.adminNotes}</span></div> : null}
                {listing.transaction && (listing.transaction.paymentStatus !== 'not_started' || listing.transaction.amount > 0) ? (
                  <div className="ai-inline-note transaction-inline-note">
                    <strong>Transaction</strong>
                    <span>{formatCurrency(listing.transaction.amount || 0)} | {formatTransactionLabel(listing.transaction.paymentMethod || 'cash')} | {formatTransactionLabel(listing.transaction.paymentStatus || 'not_started')}</span>
                    {listing.transaction.notes ? <span>{listing.transaction.notes}</span> : null}
                    {listing.transaction.sellerConfirmedAt ? <span>Seller confirmed on {formatTime(listing.transaction.sellerConfirmedAt)}</span> : null}
                  </div>
                ) : null}
                {listing.status !== 'available' ? (
                  <div className={`contact-block${listing.claimedBy ? '' : ' muted'}`}>
                    <strong>Pickup contact</strong>
                    {listing.claimedBy ? <><span>{listing.claimedBy.name}</span><span>{listing.claimedBy.phone}</span>{listing.claimedBy.pickupTime ? <span>Pickup time: {formatTime(listing.claimedBy.pickupTime)}</span> : null}</> : <span>Claimed contact details will appear here.</span>}
                  </div>
                ) : null}
                <div className="card-actions">
                  <button type="button" className="secondary-button" onClick={() => handleClaim(listing.id)} disabled={!canClaim || activeClaimId === listing.id}>{activeClaimId === listing.id ? 'Claiming...' : 'Claim listing'}</button>
                  {canComplete ? <button type="button" className="ghost-button" onClick={() => handleComplete(listing.id)}>Mark completed</button> : null}
                  {canRecordTransaction ? <button type="button" className="ghost-button" onClick={() => handleRecordTransaction(listing)}>Record payment</button> : null}
                  {canConfirmReceipt ? <button type="button" className="ghost-button" onClick={() => handleConfirmReceipt(listing)}>Confirm receipt</button> : null}
                  {canDownloadReceipt ? <button type="button" className="ghost-button" onClick={() => handleDownloadReceipt(listing)}>Download receipt</button> : null}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function SellerPage(props) {
  const { currentUser, materials, listingForm, setListingForm, imageMeta, aiClassification, classifyingImage, sellerLocationStatus, handleSubmit, handleCaptureSellerLocation, handlePhotoUpload, handleAnalyzeWaste, handleApplyAiSuggestion, submitting, estimatedPayout, notifications, notificationsLoading, unreadNotifications, handleMarkNotificationRead, handleMarkAllNotificationsRead, sellerListings, sellerMetrics, activeClaimId, handleClaim, handleComplete, handleRecordTransaction, handleConfirmReceipt, handleDownloadReceipt } = props

  return (
    <>
      <section className="hero-panel dashboard-hero">
        <article className="hero-copy">
          <span className="eyebrow">Seller workspace</span>
          <h1>Turn waste into value.</h1>
          <p className="hero-text">Publish recyclable materials with precise location details, run AI-assisted classification, and track pickup and payment confirmations.</p>
        </article>
        <article className="impact-card">
          <span className="section-kicker">Seller profile</span>
          <h2>{currentUser.name}</h2>
          <p className="helper-line">{currentUser.email}</p>
          <ul>
            <li>{sellerListings.length} listings belong to your seller account</li>
            <li>{notifications.filter((item) => !item.readAt).length} unread notifications</li>
            <li>{sellerLocationStatus || 'Capture your location before publishing a new listing'}</li>
          </ul>
        </article>
      </section>

      <section className="dashboard-metrics-bar seller-metrics">
        <article className="metric-tile">
          <strong>{sellerMetrics.total}</strong>
          <span>Your listings</span>
        </article>
        <article className="metric-tile">
          <strong>{sellerMetrics.available}</strong>
          <span>Awaiting pickup</span>
        </article>
        <article className="metric-tile">
          <strong>{sellerMetrics.paid}</strong>
          <span>Paid settlements</span>
        </article>
        <article className="metric-tile">
          <strong>{formatCurrency(sellerMetrics.estimatedValue)}</strong>
          <span>Estimated listed value</span>
        </article>
      </section>

      <section className="dashboard-grid seller-dashboard">
        <article className="panel">
          <div className="panel-heading">
            <div><span className="section-kicker">Seller flow</span><h2>Publish a recyclable listing</h2></div>
            <span className="value-chip">{formatCurrency(estimatedPayout)} est. payout</span>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <label className="full-span">Listing title<input value={listingForm.title} onChange={(event) => setListingForm((current) => ({ ...current, title: event.target.value }))} placeholder="Example: PET bottles from apartment block" required /></label>
              <label>Material<select value={listingForm.material} onChange={(event) => setListingForm((current) => ({ ...current, material: event.target.value }))}>{materials.map((material) => <option key={material.name} value={material.name}>{material.name}</option>)}</select></label>
              <label>Weight (kg)<input type="number" min="0.1" step="0.1" value={listingForm.weightKg} onChange={(event) => setListingForm((current) => ({ ...current, weightKg: event.target.value }))} required /></label>
              <label>Locality<input value={listingForm.locality} onChange={(event) => setListingForm((current) => ({ ...current, locality: event.target.value }))} required /></label>
              <label>City<input value={listingForm.city} onChange={(event) => setListingForm((current) => ({ ...current, city: event.target.value }))} required /></label>
              <label className="full-span">Upload photo<input type="file" accept="image/*" onChange={handlePhotoUpload} /></label>
              <label className="full-span">Notes<textarea rows="3" value={listingForm.notes} onChange={(event) => setListingForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Handling notes, packaging quality, pickup instructions" /></label>
              <label>Latitude<input value={listingForm.coordinates.lat} onChange={(event) => setListingForm((current) => ({ ...current, coordinates: { ...current.coordinates, lat: event.target.value } }))} required /></label>
              <label>Longitude<input value={listingForm.coordinates.lng} onChange={(event) => setListingForm((current) => ({ ...current, coordinates: { ...current.coordinates, lng: event.target.value } }))} required /></label>
            </div>
            <div className="location-card"><div className="location-card-header"><div><strong>Pin exact seller location</strong><p>Use browser geolocation to auto-fill coordinates and readable place names.</p></div><button type="button" className="secondary-button" onClick={handleCaptureSellerLocation}>Use my location</button></div><p className="helper-line">{sellerLocationStatus || 'Seller location not captured yet.'}</p></div>
            <div className="ai-card"><div className="panel-heading"><div><span className="section-kicker">AI assist</span><h2>Waste image classification</h2></div>{imageMeta ? <span className="value-chip">{imageMeta.fileName} | {imageMeta.sizeKb} KB</span> : null}</div><p className="helper-line">Upload a photo, then let the assistant suggest a likely recyclable material before publishing.</p><div className="card-actions"><button type="button" className="secondary-button" onClick={handleAnalyzeWaste} disabled={classifyingImage || !listingForm.imageUrl}>{classifyingImage ? 'Analyzing...' : 'Analyze image'}</button>{aiClassification ? <button type="button" className="ghost-button" onClick={handleApplyAiSuggestion}>Apply suggestion</button> : null}</div>{aiClassification ? <div className="ai-result-card"><strong>{aiClassification.suggestedMaterial}</strong><span>{aiClassification.suggestedFamily} | {Math.round(aiClassification.confidence * 100)}% confidence</span><p>{aiClassification.reason}</p>{aiClassification.alternatives?.length ? <div className="distance-strip">{aiClassification.alternatives.map((alternative) => <span key={alternative.material}>{alternative.material}</span>)}</div> : null}</div> : null}</div>
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Publishing...' : 'Publish listing'}</button>
          </form>
        </article>

        <NotificationsPanel notifications={notifications} notificationsLoading={notificationsLoading} unreadNotifications={unreadNotifications} handleMarkNotificationRead={handleMarkNotificationRead} handleMarkAllNotificationsRead={handleMarkAllNotificationsRead} />
        <SellerActivityPanel sellerListings={sellerListings} />
      </section>

      <ListingFeed title="Your seller-facing listing feed" kicker="Seller feed" description="Track your own listings, claimed pickups, and payment confirmations in real time." listings={sellerListings} currentUser={currentUser} activeClaimId={activeClaimId} handleClaim={handleClaim} handleComplete={handleComplete} handleRecordTransaction={handleRecordTransaction} handleConfirmReceipt={handleConfirmReceipt} handleDownloadReceipt={handleDownloadReceipt} />
    </>
  )
}

function RecyclerPage(props) {
  const { currentUser, filters, setFilters, families, localities, recyclerLocationStatus, handleCaptureRecyclerLocation, routeCandidates, routePlan, handleGenerateRoute, savedRoutes, favoriteRoutes, savedRoutesLoading, handleLoadSavedRoute, handleToggleFavorite, filteredListings, recyclerCoordinates, recyclerMetrics, recyclerScopedLoading, notifications, notificationsLoading, unreadNotifications, handleMarkNotificationRead, handleMarkAllNotificationsRead, activeClaimId, handleClaim, handleComplete, handleRecordTransaction, handleConfirmReceipt, handleDownloadReceipt } = props

  return (
    <>
      <section className="hero-panel dashboard-hero">
        <article className="hero-copy">
          <span className="eyebrow">Recycler workspace</span>
          <h1>Discover, claim, and optimize pickups.</h1>
          <p className="hero-text">Filter nearby recyclable supply, capture your live location, generate route plans, and manage physical settlement workflows.</p>
        </article>
        <article className="impact-card">
          <span className="section-kicker">Recycler profile</span>
          <h2>{currentUser.name}</h2>
          <p className="helper-line">{currentUser.email}</p>
          <ul>
            <li>{routeCandidates.length} route-ready listings under current filters</li>
            <li>{savedRoutes.length} saved route plans</li>
            <li>{recyclerLocationStatus || 'Capture your current position to start nearby planning'}</li>
          </ul>
        </article>
      </section>

      <section className="dashboard-metrics-bar recycler-metrics">
        <article className="metric-tile">
          <strong>{recyclerMetrics.routeReady}</strong>
          <span>Route-ready pickups</span>
        </article>
        <article className="metric-tile">
          <strong>{recyclerMetrics.claimed}</strong>
          <span>Claimed by you</span>
        </article>
        <article className="metric-tile">
          <strong>{recyclerMetrics.completed}</strong>
          <span>Completed pickups</span>
        </article>
        <article className="metric-tile">
          <strong>{recyclerMetrics.savedRoutes}</strong>
          <span>Saved routes</span>
        </article>
      </section>

      <section className="dashboard-grid recycler-dashboard">
        <article className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Recycler tools</span><h2>Nearby pickup planning</h2></div><span className="status-pill">{recyclerScopedLoading ? 'Loading nearby listings...' : recyclerLocationStatus || 'Capture recycler location for nearby planning'}</span></div>
          <div className="filter-grid">
            <label>Search<input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search material, title, locality" /></label>
            <label>Material family<select value={filters.family} onChange={(event) => setFilters((current) => ({ ...current, family: event.target.value }))}>{families.map((family) => <option key={family} value={family}>{family}</option>)}</select></label>
            <label>Locality<select value={filters.locality} onChange={(event) => setFilters((current) => ({ ...current, locality: event.target.value }))}>{localities.map((locality) => <option key={locality} value={locality}>{locality}</option>)}</select></label>
            <label>Availability<select value={filters.availability} onChange={(event) => setFilters((current) => ({ ...current, availability: event.target.value }))}><option value="All">All</option><option value="available">Available</option><option value="claimed">Claimed</option><option value="completed">Completed</option></select></label>
            <label>Radius (km)<select value={filters.radiusKm} onChange={(event) => setFilters((current) => ({ ...current, radiusKm: event.target.value, nearbyOnly: true }))}><option value="5">5 km</option><option value="10">10 km</option></select></label>
            <label>Nearby only<select value={filters.nearbyOnly ? 'yes' : 'no'} onChange={(event) => setFilters((current) => ({ ...current, nearbyOnly: event.target.value === 'yes' }))}><option value="no">No</option><option value="yes">Yes</option></select></label>
          </div>
          <div className="location-card recycler-location-card"><div className="location-card-header"><div><strong>Recycler live location</strong><p>Use current position for nearby filters, map radius, and route optimization.</p></div><button type="button" className="secondary-button" onClick={handleCaptureRecyclerLocation}>Capture recycler location</button></div><p className="helper-line">Recycler cards are tuned for nearby supply within a 5 km to 10 km radius.</p></div>
          <div className="workflow-note"><strong>{routeCandidates.length}</strong><span>Listings are route-ready under the current recycler filters.</span><p className="route-helper">Route planning includes available listings plus any claimed pickups assigned to the signed-in recycler.</p></div>
          <button type="button" className="primary-button route-button" onClick={handleGenerateRoute}>Generate optimized route</button>
          {routePlan ? <div className="route-panel"><strong>{routePlan.name || 'Latest route plan'}</strong><span>{routePlan.stopCount} stops | {routePlan.totalDistanceKm} km total travel</span><div className="route-stops">{routePlan.orderedStops.map((stop, index) => <div key={`${stop.id || stop.listingId}-${index}`} className="route-stop"><strong>{index + 1}. {stop.title}</strong><span>{stop.addressLabel || `${stop.locality}, ${stop.city}`}</span><span>{stop.material} | {stop.legDistanceKm} km leg</span></div>)}</div></div> : null}
          <div className="saved-routes-panel"><div className="saved-routes-header"><strong>Saved route history</strong><span className="muted-text">{savedRoutesLoading ? 'Loading...' : `${savedRoutes.length} saved plans`}</span></div>{favoriteRoutes.length ? <div className="saved-routes-list">{favoriteRoutes.map((route) => <div key={`favorite-${route.id}`} className="saved-route-card favorite-route-card"><div className="saved-route-meta"><strong>{route.name}</strong><span>{route.stopCount} stops | {route.totalDistanceKm} km</span></div><div className="saved-route-actions"><button type="button" className="ghost-button saved-route-button" onClick={() => handleLoadSavedRoute(route)}>Load template</button><button type="button" className="ghost-button saved-route-button" onClick={() => handleToggleFavorite(route)}>Remove favorite</button></div></div>)}</div> : null}<div className="saved-routes-list">{savedRoutes.map((route) => <div key={route.id} className={`saved-route-card${route.isFavorite ? ' favorite-route-card' : ''}`}><div className="saved-route-meta"><strong>{route.name || formatTime(route.createdAt)}</strong><span>{route.stopCount} stops | {route.totalDistanceKm} km</span></div><span className="muted-text">Start: {route.start?.lat}, {route.start?.lng}</span><div className="saved-route-actions"><button type="button" className="ghost-button saved-route-button" onClick={() => handleLoadSavedRoute(route)}>Reopen route</button><button type="button" className="ghost-button saved-route-button" onClick={() => handleToggleFavorite(route)}>{route.isFavorite ? 'Unfavorite' : 'Favorite'}</button></div></div>)}</div></div>
        </article>

        <article className="panel map-panel"><div className="panel-heading"><div><span className="section-kicker">Map view</span><h2>Marketplace geospatial feed</h2></div><span className="value-chip">{filteredListings.length} visible listings</span></div><MarketplaceMap listings={filteredListings} recyclerCoordinates={recyclerCoordinates} selectedRadiusKm={Number(filters.radiusKm) || 5} /></article>
      </section>

      <NotificationsPanel notifications={notifications} notificationsLoading={notificationsLoading} unreadNotifications={unreadNotifications} handleMarkNotificationRead={handleMarkNotificationRead} handleMarkAllNotificationsRead={handleMarkAllNotificationsRead} />
      <ListingFeed title="Recycler pickup feed" kicker="Recycler feed" description="Claim materials, update pickup status, and record traditional transactions from one operational queue." listings={filteredListings} currentUser={currentUser} activeClaimId={activeClaimId} handleClaim={handleClaim} handleComplete={handleComplete} handleRecordTransaction={handleRecordTransaction} handleConfirmReceipt={handleConfirmReceipt} handleDownloadReceipt={handleDownloadReceipt} />
    </>
  )
}

function AdminPage({ adminOverview, adminLoading, notifications, notificationsLoading, unreadNotifications, handleMarkNotificationRead, handleMarkAllNotificationsRead, handleModerateListing, filteredListings, adminMetrics, currentUser, activeClaimId, handleClaim, handleComplete, handleRecordTransaction, handleConfirmReceipt, handleDownloadReceipt }) {
  return (
    <>
      <section className="hero-panel dashboard-hero">
        <article className="hero-copy">
          <span className="eyebrow">Admin workspace</span>
          <h1>Moderate and monitor the exchange.</h1>
          <p className="hero-text">Review recent users, listing quality, moderation actions, and route activity through one admin operations view.</p>
        </article>
        <article className="impact-card">
          <span className="section-kicker">Admin control</span>
          <h2>Marketplace moderation dashboard</h2>
          <p className="helper-line">{adminLoading ? 'Refreshing admin dashboard...' : 'Admin controls are active.'}</p>
          <ul>
            <li>{adminOverview?.metrics?.users?.total ?? 0} total registered users</li>
            <li>{adminOverview?.metrics?.listings?.flagged ?? 0} flagged listings</li>
            <li>{adminOverview?.metrics?.transactions?.paid ?? 0} paid transactions</li>
          </ul>
        </article>
      </section>

      <section className="dashboard-metrics-bar admin-dashboard-metrics">
        <article className="metric-tile">
          <strong>{adminMetrics.users}</strong>
          <span>Total users</span>
        </article>
        <article className="metric-tile">
          <strong>{adminMetrics.listings}</strong>
          <span>Total listings</span>
        </article>
        <article className="metric-tile">
          <strong>{adminMetrics.flagged}</strong>
          <span>Flagged listings</span>
        </article>
        <article className="metric-tile">
          <strong>{adminMetrics.paid}</strong>
          <span>Paid settlements</span>
        </article>
      </section>

      <section className="panel admin-panel">
        <div className="admin-metrics">
          <article className="admin-metric-card"><strong>{adminOverview?.metrics?.users?.total ?? 0}</strong><span>Registered users</span></article>
          <article className="admin-metric-card"><strong>{adminOverview?.metrics?.listings?.total ?? 0}</strong><span>Total listings</span></article>
          <article className="admin-metric-card"><strong>{adminOverview?.metrics?.listings?.flagged ?? 0}</strong><span>Flagged listings</span></article>
          <article className="admin-metric-card"><strong>{adminOverview?.metrics?.transactions?.paid ?? 0}</strong><span>Paid settlements</span></article>
        </div>
        <div className="admin-grid">
          <div className="admin-card"><h3>Recent users</h3><div className="admin-list">{(adminOverview?.users ?? []).map((user) => <div key={user.id} className="admin-list-item"><strong>{user.name}</strong><span>{user.role} | {user.email}</span></div>)}</div></div>
          <div className="admin-card"><h3>Favorite routes</h3><div className="admin-list">{(adminOverview?.favoriteRoutes ?? []).map((route) => <div key={route.id} className="admin-list-item"><strong>{route.name || route.recyclerName}</strong><span>{route.recyclerName} | {route.stopCount} stops | {route.totalDistanceKm} km</span></div>)}</div></div>
        </div>
        <div className="admin-card"><h3>Listing moderation queue</h3><div className="admin-list">{(adminOverview?.listings ?? []).map((listing) => <div key={listing.id} className="listing-review-item"><div><strong>{listing.title}</strong><span>{listing.material} | {listing.locality}, {listing.city}</span><span>Moderation: {listing.moderationStatus}</span>{listing.aiClassification?.suggestedMaterial ? <span>AI suggested {listing.aiClassification.suggestedMaterial} | {Math.round((listing.aiClassification.confidence || 0) * 100)}%</span> : null}{listing.adminNotes ? <span>Note: {listing.adminNotes}</span> : null}</div><div className="saved-route-actions"><button type="button" className="ghost-button" onClick={() => handleModerateListing(listing.id, 'approved')}>Approve</button><button type="button" className="secondary-button" onClick={() => handleModerateListing(listing.id, 'flagged')}>Flag</button><button type="button" className="ghost-button" onClick={() => handleModerateListing(listing.id, 'rejected')}>Reject</button></div></div>)}</div></div>
      </section>

      <NotificationsPanel notifications={notifications} notificationsLoading={notificationsLoading} unreadNotifications={unreadNotifications} handleMarkNotificationRead={handleMarkNotificationRead} handleMarkAllNotificationsRead={handleMarkAllNotificationsRead} />
      <ListingFeed title="Admin marketplace feed" kicker="Admin feed" description="Review the moderated marketplace as users see it while keeping download and oversight tools available." listings={filteredListings} currentUser={currentUser} activeClaimId={activeClaimId} handleClaim={handleClaim} handleComplete={handleComplete} handleRecordTransaction={handleRecordTransaction} handleConfirmReceipt={handleConfirmReceipt} handleDownloadReceipt={handleDownloadReceipt} />
    </>
  )
}

function AppShell({ currentUser, authStatus, handleLogout, children }) {
  const location = useLocation()

  return (
    <main className="app-shell">
      <header className="top-nav">
        <div className="brand-block">
          <span className="eyebrow">Urban Waste Exchange</span>
          <strong>Role-based circular marketplace</strong>
        </div>
        <nav className="route-nav">
          <NavLink to="/" className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>Home</NavLink>
          <NavLink to="/auth" className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>{currentUser ? 'Account' : 'Login'}</NavLink>
          {currentUser?.role === 'seller' ? <NavLink to="/seller" className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>Seller</NavLink> : null}
          {currentUser?.role === 'recycler' ? <NavLink to="/recycler" className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>Recycler</NavLink> : null}
          {currentUser ? <NavLink to="/transactions" className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>Transactions</NavLink> : null}
          {currentUser?.role === 'admin' ? <NavLink to="/admin" className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>Admin</NavLink> : null}
        </nav>
        <div className="session-rail">
          {currentUser ? (
            <>
              <span className="status-pill">{currentUser.name} | {currentUser.role}</span>
              <button type="button" className="ghost-button compact-button" onClick={handleLogout}>Sign out</button>
            </>
          ) : (
            <span className="status-pill">{location.pathname === '/auth' ? 'Create your role-based account' : authStatus || 'Guest'}</span>
          )}
        </div>
      </header>
      {children}
    </main>
  )
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const [listings, setListings] = useState([])
  const [materials, setMaterials] = useState(fallbackMaterials)
  const [listingForm, setListingForm] = useState(emptyListingForm)
  const [authForm, setAuthForm] = useState(emptyAuthForm)
  const [authMode, setAuthMode] = useState('login')
  const [currentUser, setCurrentUser] = useState(null)
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('urban-exchange-token') || '')
  const [filters, setFilters] = useState(defaultFilters)
  const [submitting, setSubmitting] = useState(false)
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [classifyingImage, setClassifyingImage] = useState(false)
  const [activeClaimId, setActiveClaimId] = useState(null)
  const [statusMessage, setStatusMessage] = useState('Connecting marketplace...')
  const [authStatus, setAuthStatus] = useState('')
  const [sellerLocationStatus, setSellerLocationStatus] = useState('')
  const [recyclerLocationStatus, setRecyclerLocationStatus] = useState('')
  const [recyclerCoordinates, setRecyclerCoordinates] = useState(null)
  const [routePlan, setRoutePlan] = useState(null)
  const [savedRoutes, setSavedRoutes] = useState([])
  const [savedRoutesLoading, setSavedRoutesLoading] = useState(false)
  const [imageMeta, setImageMeta] = useState(null)
  const [aiClassification, setAiClassification] = useState(null)
  const [adminOverview, setAdminOverview] = useState(null)
  const [adminLoading, setAdminLoading] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [transactionHistory, setTransactionHistory] = useState([])
  const [transactionHistoryLoading, setTransactionHistoryLoading] = useState(false)
  const [recyclerScopedListings, setRecyclerScopedListings] = useState([])
  const [recyclerScopedLoading, setRecyclerScopedLoading] = useState(false)
  const deferredSearch = useDeferredValue(filters.search)

  useEffect(() => {
    async function loadData() {
      try {
        const [metaResponse, listingsResponse] = await Promise.all([fetch(apiUrl('/api/meta')), fetch(apiUrl('/api/listings'))])
        const metaPayload = await metaResponse.json()
        const listingsPayload = await listingsResponse.json()
        setMaterials(metaPayload.materials)
        setListings(listingsPayload)
        setStatusMessage('Marketplace live')
      } catch {
        setStatusMessage('Backend offline, showing local UI state')
      }
    }

    loadData()
    socket.connect()
    socket.on('connect', () => setStatusMessage('Marketplace live'))
    socket.on('sync', (snapshot) => startTransition(() => setListings(snapshot)))
    socket.on('listing:created', (listing) => startTransition(() => setListings((current) => [listing, ...current.filter((item) => item.id !== listing.id)])))
    socket.on('listing:updated', (listing) => startTransition(() => setListings((current) => current.map((item) => (item.id === listing.id ? listing : item)))))
    socket.on('notification:created', (notification) => {
      startTransition(() => {
        setNotifications((current) => {
          if (!currentUser || notification.userId !== currentUser.id) return current
          return [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 50)
        })
      })
    })

    return () => {
      socket.off('connect')
      socket.off('sync')
      socket.off('listing:created')
      socket.off('listing:updated')
      socket.off('notification:created')
      socket.disconnect()
    }
  }, [currentUser])

  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null)
      setSavedRoutes([])
      setAdminOverview(null)
      setNotifications([])
      setTransactionHistory([])
      return
    }

    async function loadSession() {
      try {
        const response = await fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${authToken}` } })
        if (!response.ok) throw new Error('Session expired')
        const payload = await response.json()
        setCurrentUser(payload.user)
        setAuthStatus(`Signed in as ${payload.user.name} (${payload.user.role})`)
      } catch {
        localStorage.removeItem('urban-exchange-token')
        setAuthToken('')
        setCurrentUser(null)
        setSavedRoutes([])
        setAdminOverview(null)
        setNotifications([])
        setTransactionHistory([])
        setAuthStatus('Session expired. Please sign in again.')
      }
    }

    loadSession()
  }, [authToken])

  useEffect(() => {
    if (!authToken) {
      setNotifications([])
      return
    }

    async function loadNotifications() {
      setNotificationsLoading(true)
      try {
        const response = await fetch(apiUrl('/api/notifications/my?limit=50'), { headers: { Authorization: `Bearer ${authToken}` } })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message || 'Could not load notifications.')
        setNotifications(payload)
      } catch (error) {
        setStatusMessage(error.message || 'Could not load notifications.')
      } finally {
        setNotificationsLoading(false)
      }
    }

    loadNotifications()
  }, [authToken])

  useEffect(() => {
    if (!authToken || !currentUser) {
      setTransactionHistory([])
      return
    }

    async function loadTransactionHistory() {
      setTransactionHistoryLoading(true)
      try {
        const response = await fetch(apiUrl('/api/transactions/my'), { headers: { Authorization: `Bearer ${authToken}` } })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message || 'Could not load transaction history.')
        setTransactionHistory(payload)
      } catch (error) {
        setStatusMessage(error.message || 'Could not load transaction history.')
      } finally {
        setTransactionHistoryLoading(false)
      }
    }

    loadTransactionHistory()
  }, [authToken, currentUser])

  useEffect(() => {
    if (!authToken || currentUser?.role !== 'recycler') {
      setSavedRoutes([])
      return
    }

    async function loadSavedRoutes() {
      setSavedRoutesLoading(true)
      try {
        const response = await fetch(apiUrl('/api/routes/my'), { headers: { Authorization: `Bearer ${authToken}` } })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message || 'Could not load saved routes.')
        setSavedRoutes(payload)
      } catch (error) {
        setRecyclerLocationStatus(error.message || 'Could not load saved routes.')
      } finally {
        setSavedRoutesLoading(false)
      }
    }

    loadSavedRoutes()
  }, [authToken, currentUser])

  useEffect(() => {
    if (!authToken || currentUser?.role !== 'admin') {
      setAdminOverview(null)
      return
    }

    async function loadAdminOverview() {
      setAdminLoading(true)
      try {
        const response = await fetch(apiUrl('/api/admin/overview'), { headers: { Authorization: `Bearer ${authToken}` } })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message || 'Could not load admin dashboard.')
        setAdminOverview(payload)
      } catch (error) {
        setStatusMessage(error.message || 'Could not load admin dashboard.')
      } finally {
        setAdminLoading(false)
      }
    }

    loadAdminOverview()
  }, [authToken, currentUser])

  useEffect(() => {
    if (
      !authToken ||
      currentUser?.role !== 'recycler' ||
      location.pathname !== '/recycler' ||
      !recyclerCoordinates
    ) {
      setRecyclerScopedListings([])
      setRecyclerScopedLoading(false)
      return
    }

    const controller = new AbortController()

    async function loadRecyclerScopedListings() {
      setRecyclerScopedLoading(true)
      try {
        const params = new URLSearchParams({
          lat: String(recyclerCoordinates.lat),
          lng: String(recyclerCoordinates.lng),
          radiusKm: String(Number(filters.radiusKm) || 10),
        })

        if (filters.family !== 'All') params.set('family', filters.family)
        if (filters.locality !== 'All') params.set('locality', filters.locality)
        if (filters.availability !== 'All') params.set('status', filters.availability)
        if (deferredSearch.trim()) params.set('search', deferredSearch.trim())

        const response = await fetch(apiUrl(`/api/listings?${params.toString()}`), {
          signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message || 'Could not load nearby recycler listings.')
        setRecyclerScopedListings(payload)
      } catch (error) {
        if (error.name === 'AbortError') return
        setRecyclerLocationStatus(error.message || 'Could not load nearby recycler listings.')
      } finally {
        if (!controller.signal.aborted) {
          setRecyclerScopedLoading(false)
        }
      }
    }

    loadRecyclerScopedListings()

    return () => controller.abort()
  }, [
    authToken,
    currentUser,
    deferredSearch,
    filters.availability,
    filters.family,
    filters.locality,
    filters.radiusKm,
    location.pathname,
    recyclerCoordinates,
  ])

  const summary = useMemo(() => ({
    total: listings.length,
    available: listings.filter((item) => item.status === 'available').length,
    claimed: listings.filter((item) => item.status === 'claimed').length,
    geoTagged: listings.filter((item) => item.coordinates?.lat != null && item.coordinates?.lng != null).length,
  }), [listings])

  const localities = useMemo(() => ['All', ...new Set(listings.map((item) => item.locality).filter(Boolean))], [listings])
  const families = useMemo(() => ['All', ...new Set(materials.map((item) => item.family).filter(Boolean))], [materials])
  const favoriteRoutes = useMemo(() => savedRoutes.filter((route) => route.isFavorite), [savedRoutes])
  const unreadNotifications = useMemo(() => notifications.filter((item) => !item.readAt).length, [notifications])

  const filteredListings = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase()
    const radiusLimit = Number(filters.radiusKm) || 5
    return listings
      .map((item) => ({ ...item, computedDistanceKm: item.distanceKm ?? calculateDistanceKm(recyclerCoordinates, item.coordinates) }))
      .filter((item) => {
        const matchesQuery = !query || item.title.toLowerCase().includes(query) || item.material.toLowerCase().includes(query) || item.locality.toLowerCase().includes(query)
        const matchesFamily = filters.family === 'All' || item.family === filters.family
        const matchesLocality = filters.locality === 'All' || item.locality === filters.locality
        const matchesAvailability = filters.availability === 'All' || item.status === filters.availability
        const matchesNearby = !filters.nearbyOnly || (item.computedDistanceKm != null && item.computedDistanceKm <= radiusLimit)
        return matchesQuery && matchesFamily && matchesLocality && matchesAvailability && matchesNearby
      })
      .sort((left, right) => {
        if (!filters.nearbyOnly || !recyclerCoordinates) return new Date(right.createdAt) - new Date(left.createdAt)
        if (left.computedDistanceKm == null) return 1
        if (right.computedDistanceKm == null) return -1
        return left.computedDistanceKm - right.computedDistanceKm
      })
  }, [deferredSearch, filters, listings, recyclerCoordinates])

  const recyclerFeedListings = useMemo(() => {
    if (
      currentUser?.role !== 'recycler' ||
      location.pathname !== '/recycler' ||
      !recyclerCoordinates
    ) {
      return filteredListings
    }

    const scoped = recyclerScopedListings.map((item) => ({
      ...item,
      computedDistanceKm: item.distanceKm ?? calculateDistanceKm(recyclerCoordinates, item.coordinates),
    }))

    return scoped.sort((left, right) => {
      if (left.computedDistanceKm == null) return 1
      if (right.computedDistanceKm == null) return -1
      return left.computedDistanceKm - right.computedDistanceKm
    })
  }, [currentUser, filteredListings, location.pathname, recyclerCoordinates, recyclerScopedListings])

  const routeCandidates = useMemo(() => {
    if (!currentUser || currentUser.role !== 'recycler') return []
    return recyclerFeedListings.filter((listing) => listing.coordinates?.lat != null && listing.coordinates?.lng != null && listing.moderationStatus !== 'rejected' && (listing.status === 'available' || (listing.status === 'claimed' && listing.claimedBy?.userId === currentUser.id)))
  }, [currentUser, recyclerFeedListings])

  const sellerListings = useMemo(() => {
    if (!currentUser || currentUser.role !== 'seller') return []
    return filteredListings.filter((listing) => listing.sellerId === currentUser.id)
  }, [currentUser, filteredListings])

  const sellerMetrics = useMemo(
    () => ({
      total: sellerListings.length,
      available: sellerListings.filter((listing) => listing.status === 'available').length,
      paid: sellerListings.filter((listing) => listing.transaction?.paymentStatus === 'paid').length,
      estimatedValue: sellerListings.reduce(
        (sum, listing) => sum + Number(listing.estimatedValue || 0),
        0,
      ),
    }),
    [sellerListings],
  )

  const recyclerMetrics = useMemo(
    () => ({
      routeReady: routeCandidates.length,
      claimed: recyclerFeedListings.filter(
        (listing) =>
          listing.status === 'claimed' && listing.claimedBy?.userId === currentUser?.id,
      ).length,
      completed: recyclerFeedListings.filter(
        (listing) =>
          listing.status === 'completed' && listing.claimedBy?.userId === currentUser?.id,
      ).length,
      savedRoutes: savedRoutes.length,
    }),
    [currentUser, recyclerFeedListings, routeCandidates.length, savedRoutes.length],
  )

  const adminMetrics = useMemo(
    () => ({
      users: adminOverview?.metrics?.users?.total ?? 0,
      listings: adminOverview?.metrics?.listings?.total ?? 0,
      flagged: adminOverview?.metrics?.listings?.flagged ?? 0,
      paid: adminOverview?.metrics?.transactions?.paid ?? 0,
    }),
    [adminOverview],
  )

  const selectedMaterial = materials.find((item) => item.name === listingForm.material)
  const estimatedPayout = selectedMaterial ? Math.round((Number(listingForm.weightKg) || 0) * selectedMaterial.ratePerKg) : 0

  async function handlePhotoUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const imageData = await file.arrayBuffer()
    const bytes = new Uint8Array(imageData)
    let binary = ''
    bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
    setListingForm((current) => ({ ...current, imageUrl: `data:${file.type};base64,${window.btoa(binary)}` }))
    setImageMeta({ fileName: file.name, mimeType: file.type, sizeKb: Number((file.size / 1024).toFixed(1)) })
    setAiClassification(null)
  }

  async function handleAnalyzeWaste() {
    if (!authToken || !listingForm.imageUrl) {
      setSellerLocationStatus('Upload a listing photo before running AI classification.')
      return
    }
    setClassifyingImage(true)
    try {
      const response = await fetch(apiUrl('/api/classify-waste'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ fileName: imageMeta?.fileName, title: listingForm.title, notes: listingForm.notes, imageUrl: listingForm.imageUrl }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'AI classification failed.')
      setAiClassification(payload)
      setSellerLocationStatus(`AI suggests ${payload.suggestedMaterial} with ${Math.round(payload.confidence * 100)}% confidence.`)
    } catch (error) {
      setSellerLocationStatus(error.message || 'Could not analyze image.')
    } finally {
      setClassifyingImage(false)
    }
  }

  function handleApplyAiSuggestion() {
    if (!aiClassification) return
    setListingForm((current) => ({ ...current, material: aiClassification.suggestedMaterial }))
    setSellerLocationStatus(`Applied AI suggestion: ${aiClassification.suggestedMaterial}.`)
  }

  function requestBrowserLocation(onSuccess, onError, setLoadingMessage) {
    if (!navigator.geolocation) {
      onError('Geolocation is not supported in this browser.')
      return
    }
    setLoadingMessage('Requesting device location...')
    navigator.geolocation.getCurrentPosition(
      (position) => onSuccess({ lat: Number(position.coords.latitude.toFixed(6)), lng: Number(position.coords.longitude.toFixed(6)) }),
      (error) => onError(error.message || 'Could not access device location.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  function handleCaptureSellerLocation() {
    requestBrowserLocation(
      async (coords) => {
        setListingForm((current) => ({ ...current, coordinates: { lat: String(coords.lat), lng: String(coords.lng) } }))
        try {
          const place = await reverseGeocode(coords.lat, coords.lng)
          setListingForm((current) => ({ ...current, locality: current.locality || place.locality, city: current.city === 'Bengaluru' ? place.city || current.city : current.city, coordinates: { lat: String(coords.lat), lng: String(coords.lng) } }))
          setSellerLocationStatus(`Pinned listing at ${place.addressLabel || `${place.locality}, ${place.city}`}`)
        } catch {
          setSellerLocationStatus(`Pinned listing at ${coords.lat}, ${coords.lng}`)
        }
      },
      setSellerLocationStatus,
      setSellerLocationStatus,
    )
  }

  function handleCaptureRecyclerLocation() {
    requestBrowserLocation(
      async (coords) => {
        setRecyclerCoordinates(coords)
        setFilters((current) => ({ ...current, nearbyOnly: true, radiusKm: '10' }))
        try {
          const place = await reverseGeocode(coords.lat, coords.lng)
          setRecyclerLocationStatus(`Searching near ${place.addressLabel || `${place.locality}, ${place.city}`}`)
        } catch {
          setRecyclerLocationStatus(`Searching from ${coords.lat}, ${coords.lng}`)
        }
      },
      setRecyclerLocationStatus,
      setRecyclerLocationStatus,
    )
  }

  async function handleAuthSubmit(event) {
    event.preventDefault()
    const validationMessage = validateAuthForm(authMode, authForm)
    if (validationMessage) {
      setAuthStatus(validationMessage)
      return
    }
    setAuthSubmitting(true)
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const body = authMode === 'register' ? authForm : { email: authForm.email, password: authForm.password }
      const response = await fetch(apiUrl(endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Authentication failed.')
      localStorage.setItem('urban-exchange-token', payload.token)
      setAuthToken(payload.token)
      setCurrentUser(payload.user)
      setAuthStatus(`Signed in as ${payload.user.name} (${payload.user.role})`)
      setAuthForm(emptyAuthForm)
      navigate(getDashboardPath(payload.user.role), { replace: true })
    } catch (error) {
      setAuthStatus(error.message)
    } finally {
      setAuthSubmitting(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('urban-exchange-token')
    setAuthToken('')
    setCurrentUser(null)
    setSavedRoutes([])
    setAdminOverview(null)
    setTransactionHistory([])
    setRoutePlan(null)
    setAiClassification(null)
    setImageMeta(null)
    setFilters(defaultFilters)
    setRecyclerCoordinates(null)
    setAuthStatus('Signed out successfully.')
    navigate('/', { replace: true })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!currentUser || currentUser.role !== 'seller') {
      setSellerLocationStatus('Sign in as a seller to publish listings.')
      return
    }
    const validationMessage = validateListingForm(listingForm)
    if (validationMessage) {
      setSellerLocationStatus(validationMessage)
      return
    }
    setSubmitting(true)
    try {
      const response = await fetch(apiUrl('/api/listings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ ...listingForm, aiClassification, coordinates: { lat: Number(listingForm.coordinates.lat), lng: Number(listingForm.coordinates.lng) } }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Listing creation failed')
      setListingForm(emptyListingForm)
      setImageMeta(null)
      setAiClassification(null)
      setSellerLocationStatus('Listing published with geolocation attached.')
    } catch (error) {
      setStatusMessage(error.message || 'Could not create listing.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleClaim(listingId) {
    if (!currentUser || currentUser.role !== 'recycler') {
      setAuthStatus('Sign in as a recycler to claim listings.')
      return
    }

    const pickupTime = window.prompt(
      'Enter pickup date and time in this format: YYYY-MM-DD HH:MM',
      '',
    )

    if (pickupTime == null) return

    const normalizedPickupTime = pickupTime.trim().replace(' ', 'T')

    if (!normalizedPickupTime) {
      setStatusMessage('Pickup time is required before claiming a listing.')
      return
    }

    const parsedPickupTime = new Date(normalizedPickupTime)

    if (Number.isNaN(parsedPickupTime.getTime())) {
      setStatusMessage('Pickup time must be a valid date and time.')
      return
    }

    setActiveClaimId(listingId)
    try {
      const response = await fetch(apiUrl(`/api/listings/${listingId}/claim`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ pickupTime: normalizedPickupTime }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Claim failed')
    } catch (error) {
      setStatusMessage(error.message || 'Claim failed.')
    } finally {
      setActiveClaimId(null)
    }
  }

  async function handleComplete(listingId) {
    try {
      const response = await fetch(apiUrl(`/api/listings/${listingId}/complete`), { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Completion failed.')
      setRecyclerLocationStatus('Pickup marked as completed. Payment status moved to pending settlement.')
    } catch (error) {
      setRecyclerLocationStatus(error.message || 'Completion failed.')
    }
  }

  async function handleMarkNotificationRead(notificationId) {
    if (!authToken) return
    try {
      const response = await fetch(apiUrl(`/api/notifications/${notificationId}/read`), { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Could not mark notification as read.')
      setNotifications((current) => current.map((item) => (item.id === notificationId ? payload : item)))
    } catch (error) {
      setStatusMessage(error.message || 'Could not mark notification as read.')
    }
  }

  async function handleMarkAllNotificationsRead() {
    if (!authToken) return
    try {
      const response = await fetch(apiUrl('/api/notifications/read-all'), { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Could not mark notifications as read.')
      setNotifications(payload)
    } catch (error) {
      setStatusMessage(error.message || 'Could not mark notifications as read.')
    }
  }

  async function handleDownloadReceipt(listing) {
    try {
      const response = await fetch(apiUrl(`/api/listings/${listing.id}/receipt`), { headers: { Authorization: `Bearer ${authToken}` } })
      if (!response.ok) {
        const payload = await response.json()
        throw new Error(payload.message || 'Could not download receipt.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `urban-waste-receipt-${listing.id}.txt`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setStatusMessage(error.message || 'Could not download receipt.')
    }
  }

  async function handleConfirmReceipt(listing) {
    try {
      const response = await fetch(apiUrl(`/api/listings/${listing.id}/transaction/confirm`), { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Could not confirm receipt.')
      setStatusMessage('Receipt confirmed successfully.')
      setListings((current) => current.map((item) => (item.id === payload.id ? payload : item)))
      setTransactionHistory((current) => [payload, ...current.filter((item) => item.id !== payload.id)].sort((left, right) => new Date(right.transaction?.recordedAt || right.updatedAt || right.createdAt) - new Date(left.transaction?.recordedAt || left.updatedAt || left.createdAt)))
    } catch (error) {
      setStatusMessage(error.message || 'Could not confirm receipt.')
    }
  }

  async function handleRecordTransaction(listing) {
    const amountInput = window.prompt(`Enter settlement amount for "${listing.title}"`, String(listing.transaction?.amount || listing.estimatedValue || ''))
    if (amountInput == null) return
    const paymentMethod = (window.prompt('Enter payment method: cash, bank_transfer, or cheque', 'cash') || 'cash').trim()
    const paymentStatus = (window.prompt('Enter payment status: pending or paid', 'paid') || 'paid').trim()
    const notes = (window.prompt('Optional notes for this payment', listing.transaction?.notes || '') || '').trim()
    const parsedAmount = Number(amountInput)

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setRecyclerLocationStatus('Enter a settlement amount greater than zero.')
      return
    }

    if (!['cash', 'bank_transfer', 'cheque'].includes(paymentMethod)) {
      setRecyclerLocationStatus('Payment method must be cash, bank_transfer, or cheque.')
      return
    }

    if (!['pending', 'paid'].includes(paymentStatus)) {
      setRecyclerLocationStatus('Payment status must be pending or paid.')
      return
    }

    if (notes.length > 280) {
      setRecyclerLocationStatus('Payment notes must be 280 characters or fewer.')
      return
    }

    try {
      const response = await fetch(apiUrl(`/api/listings/${listing.id}/transaction`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ amount: parsedAmount, paymentMethod, paymentStatus, notes }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Could not record transaction.')
      setRecyclerLocationStatus('Transaction details recorded successfully.')
      setListings((current) => current.map((item) => (item.id === payload.id ? payload : item)))
      setTransactionHistory((current) => [payload, ...current.filter((item) => item.id !== payload.id)].sort((left, right) => new Date(right.transaction?.recordedAt || right.updatedAt || right.createdAt) - new Date(left.transaction?.recordedAt || left.updatedAt || left.createdAt)))
    } catch (error) {
      setRecyclerLocationStatus(error.message || 'Could not record transaction.')
    }
  }

  async function handleGenerateRoute() {
    if (!currentUser || currentUser.role !== 'recycler') {
      setRecyclerLocationStatus('Sign in as a recycler to generate routes.')
      return
    }
    if (!recyclerCoordinates) {
      setRecyclerLocationStatus('Capture recycler location before generating a route.')
      return
    }
    if (!routeCandidates.length) {
      setRecyclerLocationStatus('No route-ready listings are available under current filters.')
      return
    }
    try {
      const response = await fetch(apiUrl('/api/routes/optimize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ start: recyclerCoordinates, listingIds: routeCandidates.map((listing) => listing.id), filters }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Could not generate route.')
      setRoutePlan(payload)
      setSavedRoutes((current) => [{ ...payload, id: payload.routeId, start: recyclerCoordinates, isFavorite: false, filters: { ...filters } }, ...current.filter((route) => route.id !== payload.routeId)])
      setRecyclerLocationStatus('Optimized route generated and saved.')
    } catch (error) {
      setRecyclerLocationStatus(error.message || 'Could not generate route.')
    }
  }

  function handleLoadSavedRoute(route) {
    setRoutePlan(route)
    if (route.start?.lat != null && route.start?.lng != null) setRecyclerCoordinates(route.start)
    if (route.filters) {
      setFilters((current) => ({ ...current, search: route.filters.search ?? '', family: route.filters.family ?? 'All', locality: route.filters.locality ?? 'All', availability: route.filters.availability ?? 'All', nearbyOnly: Boolean(route.filters.nearbyOnly), radiusKm: String(route.filters.radiusKm ?? 5) }))
    }
    setRecyclerLocationStatus('Saved route loaded into the recycler workspace.')
  }

  async function handleToggleFavorite(route) {
    if (!authToken) return
    const nextFavorite = !route.isFavorite
    const nextName = nextFavorite ? window.prompt('Name this favorite route template', route.name || 'Favorite route') : ''
    if (nextFavorite && nextName == null) return

    try {
      const response = await fetch(apiUrl(`/api/routes/${route.id}/favorite`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ isFavorite: nextFavorite, name: nextFavorite ? nextName : '' }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Could not update favorite route.')
      setSavedRoutes((current) => current.map((item) => (item.id === payload.id ? payload : item)))
    } catch (error) {
      setRecyclerLocationStatus(error.message || 'Could not update favorite route.')
    }
  }

  async function handleModerateListing(listingId, moderationStatus) {
    try {
      const response = await fetch(apiUrl(`/api/admin/listings/${listingId}/moderate`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ moderationStatus }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Could not update moderation.')
      setAdminOverview((current) => {
        if (!current) return current
        return { ...current, listings: current.listings.map((listing) => (listing.id === payload.id ? payload : listing)) }
      })
      setListings((current) => current.map((listing) => (listing.id === payload.id ? payload : listing)))
      setStatusMessage(`Listing marked as ${moderationStatus}.`)
    } catch (error) {
      setStatusMessage(error.message || 'Could not update moderation.')
    }
  }

  return (
    <AppShell currentUser={currentUser} authStatus={authStatus} handleLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<PublicHome currentUser={currentUser} summary={summary} statusMessage={statusMessage} unreadNotifications={unreadNotifications} filteredListings={filteredListings} />} />
        <Route path="/auth" element={<AuthPage authMode={authMode} authForm={authForm} setAuthForm={setAuthForm} setAuthMode={setAuthMode} handleAuthSubmit={handleAuthSubmit} authSubmitting={authSubmitting} authStatus={authStatus} currentUser={currentUser} handleLogout={handleLogout} />} />
        <Route path="/seller" element={<RoleGuard currentUser={currentUser} role="seller"><SellerPage currentUser={currentUser} materials={materials} listingForm={listingForm} setListingForm={setListingForm} imageMeta={imageMeta} aiClassification={aiClassification} classifyingImage={classifyingImage} sellerLocationStatus={sellerLocationStatus} handleSubmit={handleSubmit} handleCaptureSellerLocation={handleCaptureSellerLocation} handlePhotoUpload={handlePhotoUpload} handleAnalyzeWaste={handleAnalyzeWaste} handleApplyAiSuggestion={handleApplyAiSuggestion} submitting={submitting} estimatedPayout={estimatedPayout} notifications={notifications} notificationsLoading={notificationsLoading} unreadNotifications={unreadNotifications} handleMarkNotificationRead={handleMarkNotificationRead} handleMarkAllNotificationsRead={handleMarkAllNotificationsRead} sellerListings={sellerListings} sellerMetrics={sellerMetrics} activeClaimId={activeClaimId} handleClaim={handleClaim} handleComplete={handleComplete} handleRecordTransaction={handleRecordTransaction} handleConfirmReceipt={handleConfirmReceipt} handleDownloadReceipt={handleDownloadReceipt} /></RoleGuard>} />
        <Route path="/recycler" element={<RoleGuard currentUser={currentUser} role="recycler"><RecyclerPage currentUser={currentUser} filters={filters} setFilters={setFilters} families={families} localities={localities} recyclerLocationStatus={recyclerLocationStatus} handleCaptureRecyclerLocation={handleCaptureRecyclerLocation} routeCandidates={routeCandidates} routePlan={routePlan} handleGenerateRoute={handleGenerateRoute} savedRoutes={savedRoutes} favoriteRoutes={favoriteRoutes} savedRoutesLoading={savedRoutesLoading} handleLoadSavedRoute={handleLoadSavedRoute} handleToggleFavorite={handleToggleFavorite} filteredListings={recyclerFeedListings} recyclerCoordinates={recyclerCoordinates} recyclerMetrics={recyclerMetrics} recyclerScopedLoading={recyclerScopedLoading} notifications={notifications} notificationsLoading={notificationsLoading} unreadNotifications={unreadNotifications} handleMarkNotificationRead={handleMarkNotificationRead} handleMarkAllNotificationsRead={handleMarkAllNotificationsRead} activeClaimId={activeClaimId} handleClaim={handleClaim} handleComplete={handleComplete} handleRecordTransaction={handleRecordTransaction} handleConfirmReceipt={handleConfirmReceipt} handleDownloadReceipt={handleDownloadReceipt} /></RoleGuard>} />
        <Route path="/transactions" element={<RoleGuard currentUser={currentUser}><TransactionHistoryPage currentUser={currentUser} transactionHistory={transactionHistory} transactionHistoryLoading={transactionHistoryLoading} handleDownloadReceipt={handleDownloadReceipt} /></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard currentUser={currentUser} role="admin"><AdminPage adminOverview={adminOverview} adminLoading={adminLoading} notifications={notifications} notificationsLoading={notificationsLoading} unreadNotifications={unreadNotifications} handleMarkNotificationRead={handleMarkNotificationRead} handleMarkAllNotificationsRead={handleMarkAllNotificationsRead} handleModerateListing={handleModerateListing} filteredListings={filteredListings} adminMetrics={adminMetrics} currentUser={currentUser} activeClaimId={activeClaimId} handleClaim={handleClaim} handleComplete={handleComplete} handleRecordTransaction={handleRecordTransaction} handleConfirmReceipt={handleConfirmReceipt} handleDownloadReceipt={handleDownloadReceipt} /></RoleGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}

export default App

