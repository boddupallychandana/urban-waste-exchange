
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import MarketplaceMap from './components/MarketplaceMap.jsx'
import './App.css'

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

const socket = io({ autoConnect: false })

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

async function reverseGeocode(lat, lng) {
  const response = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message || 'Reverse geocoding failed.')
  return payload
}

function App() {
  const [listings, setListings] = useState([])
  const [materials, setMaterials] = useState(fallbackMaterials)
  const [listingForm, setListingForm] = useState(emptyListingForm)
  const [authForm, setAuthForm] = useState(emptyAuthForm)
  const [authMode, setAuthMode] = useState('login')
  const [currentUser, setCurrentUser] = useState(null)
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('urban-exchange-token') || '')
  const [filters, setFilters] = useState({ search: '', family: 'All', locality: 'All', availability: 'All', nearbyOnly: false, radiusKm: '5' })
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
  const deferredSearch = useDeferredValue(filters.search)

  useEffect(() => {
    async function loadData() {
      try {
        const [metaResponse, listingsResponse] = await Promise.all([fetch('/api/meta'), fetch('/api/listings')])
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
          return [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 12)
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
      return
    }

    async function loadSession() {
      try {
        const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${authToken}` } })
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
        const response = await fetch('/api/notifications/my', { headers: { Authorization: `Bearer ${authToken}` } })
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
    if (!authToken || currentUser?.role !== 'recycler') {
      setSavedRoutes([])
      return
    }

    async function loadSavedRoutes() {
      setSavedRoutesLoading(true)
      try {
        const response = await fetch('/api/routes/my', { headers: { Authorization: `Bearer ${authToken}` } })
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
        const response = await fetch('/api/admin/overview', { headers: { Authorization: `Bearer ${authToken}` } })
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

  const summary = useMemo(() => ({
    total: listings.length,
    available: listings.filter((item) => item.status === 'available').length,
    claimed: listings.filter((item) => item.status === 'claimed').length,
    geoTagged: listings.filter((item) => item.coordinates?.lat != null && item.coordinates?.lng != null).length,
  }), [listings])

  const localities = useMemo(() => ['All', ...new Set(listings.map((item) => item.locality))], [listings])
  const families = useMemo(() => ['All', ...new Set(materials.map((item) => item.family))], [materials])
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

  const routeCandidates = useMemo(() => {
    if (!currentUser || currentUser.role !== 'recycler') return []
    return filteredListings.filter((listing) => listing.coordinates?.lat != null && listing.coordinates?.lng != null && listing.moderationStatus !== 'rejected' && (listing.status === 'available' || (listing.status === 'claimed' && listing.claimedBy?.userId === currentUser.id)))
  }, [currentUser, filteredListings])

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
      const response = await fetch('/api/classify-waste', {
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
          setListingForm((current) => ({
            ...current,
            locality: current.locality || place.locality,
            city: current.city === 'Bengaluru' ? place.city || current.city : current.city,
            coordinates: { lat: String(coords.lat), lng: String(coords.lng) },
          }))
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
        setFilters((current) => ({ ...current, nearbyOnly: true }))
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
    setAuthSubmitting(true)
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const body = authMode === 'register' ? authForm : { email: authForm.email, password: authForm.password }
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Authentication failed.')
      localStorage.setItem('urban-exchange-token', payload.token)
      setAuthToken(payload.token)
      setCurrentUser(payload.user)
      setAuthStatus(`Signed in as ${payload.user.name} (${payload.user.role})`)
      setAuthForm(emptyAuthForm)
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
    setRoutePlan(null)
    setAiClassification(null)
    setImageMeta(null)
    setAuthStatus('Signed out successfully.')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!currentUser || currentUser.role !== 'seller') {
      setSellerLocationStatus('Sign in as a seller to publish listings.')
      return
    }
    if (!listingForm.coordinates.lat || !listingForm.coordinates.lng) {
      setSellerLocationStatus('Capture or enter coordinates before publishing the listing.')
      return
    }
    setSubmitting(true)
    try {
      const response = await fetch('/api/listings', {
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
    setActiveClaimId(listingId)
    try {
      const response = await fetch(`/api/listings/${listingId}/claim`, { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` } })
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
      const response = await fetch(`/api/listings/${listingId}/complete`, { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` } })
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
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Could not update notification.')
      setNotifications((current) => current.map((item) => (item.id === payload.id ? payload : item)))
    } catch (error) {
      setStatusMessage(error.message || 'Could not update notification.')
    }
  }
  async function handleDownloadReceipt(listing) {
    if (!authToken) return

    try {
      const response = await fetch(`/api/listings/${listing.id}/receipt`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })

      if (!response.ok) {
        const payload = await response.json()
        throw new Error(payload.message || 'Receipt download failed.')
      }

      const receiptText = await response.text()
      const blob = new Blob([receiptText], { type: 'text/plain;charset=utf-8' })
      const link = document.createElement('a')
      const safeTitle = listing.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'listing'
      link.href = URL.createObjectURL(blob)
      link.download = `urban-waste-receipt-${safeTitle}.txt`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)
      setStatusMessage('Transaction receipt downloaded.')
    } catch (error) {
      setStatusMessage(error.message || 'Receipt download failed.')
    }
  }
  async function handleConfirmReceipt(listing) {
    if (!authToken || currentUser?.role !== 'seller') return

    try {
      const response = await fetch(`/api/listings/${listing.id}/transaction/confirm`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Receipt confirmation failed.')
      setSellerLocationStatus('Payment receipt confirmed for this listing.')
    } catch (error) {
      setSellerLocationStatus(error.message || 'Receipt confirmation failed.')
    }
  }

  async function handleRecordTransaction(listing) {
    if (!authToken || currentUser?.role !== 'recycler') return

    const defaultAmount = String(listing.transaction?.amount || listing.estimatedValue || '')
    const amountInput = window.prompt('Enter the agreed payout amount (INR):', defaultAmount)
    if (amountInput == null) return

    const amount = Number(amountInput)
    if (!Number.isFinite(amount) || amount < 0) {
      setRecyclerLocationStatus('Enter a valid transaction amount.')
      return
    }

    const defaultMethod = listing.transaction?.paymentMethod || 'cash'
    const paymentMethod = window.prompt('Payment method: cash, bank_transfer, or cheque', defaultMethod)?.trim()
    if (!paymentMethod) return

    const defaultStatus = listing.transaction?.paymentStatus && listing.transaction.paymentStatus !== 'not_started'
      ? listing.transaction.paymentStatus
      : 'paid'
    const paymentStatus = window.prompt('Payment status: pending or paid', defaultStatus)?.trim()
    if (!paymentStatus) return

    const notes = window.prompt('Optional transaction notes or receipt reference:', listing.transaction?.notes || '')
    if (notes == null) return

    try {
      const response = await fetch(`/api/listings/${listing.id}/transaction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ amount, paymentMethod, paymentStatus, notes }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Transaction update failed.')
      setRecyclerLocationStatus(`Transaction recorded as ${formatTransactionLabel(payload.transaction.paymentStatus)}.`)
    } catch (error) {
      setRecyclerLocationStatus(error.message || 'Transaction update failed.')
    }
  }
  async function handleGenerateRoute() {
    if (!currentUser || currentUser.role !== 'recycler') {
      setAuthStatus('Sign in as a recycler to generate route plans.')
      return
    }
    if (!recyclerCoordinates) {
      setRecyclerLocationStatus('Capture recycler location before generating a route plan.')
      return
    }
    const routeListingIds = routeCandidates.map((listing) => listing.id)
    if (routeListingIds.length === 0) {
      setRoutePlan(null)
      setRecyclerLocationStatus('No route-ready listings match the current filters.')
      return
    }
    try {
      const response = await fetch('/api/routes/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ start: recyclerCoordinates, listingIds: routeListingIds, filters }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Route optimization failed.')
      setRoutePlan(payload)
      setSavedRoutes((current) => [{
        id: payload.routeId,
        createdAt: payload.createdAt,
        recyclerName: currentUser.name,
        start: recyclerCoordinates,
        totalDistanceKm: payload.totalDistanceKm,
        stopCount: payload.stopCount,
        name: '',
        isFavorite: false,
        orderedStops: payload.orderedStops.map((stop) => ({ ...stop, listingId: stop.id })),
        filters: { ...filters, radiusKm: Number(filters.radiusKm) || 5 },
      }, ...current.filter((route) => route.id !== payload.routeId)].slice(0, 8))
      setRecyclerLocationStatus(`Optimized route with ${payload.stopCount} stops and ${payload.totalDistanceKm} km total travel.`)
    } catch (error) {
      setRecyclerLocationStatus(error.message || 'Could not generate route.')
    }
  }

  async function handleToggleFavorite(route) {
    if (!authToken || currentUser?.role !== 'recycler') return
    const nextFavorite = !route.isFavorite
    const nextName = nextFavorite ? window.prompt('Name this favorite route template:', route.name || 'Morning pickup circuit')?.trim() : ''
    if (nextFavorite && !nextName) return
    try {
      const response = await fetch(`/api/routes/${route.id}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ isFavorite: nextFavorite, name: nextName }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Could not update route favorite.')
      setSavedRoutes((current) => current.map((item) => (item.id === payload.id ? payload : item)))
      if (routePlan?.routeId === payload.id || routePlan?.id === payload.id) setRoutePlan((current) => ({ ...current, isFavorite: payload.isFavorite, name: payload.name }))
      setRecyclerLocationStatus(payload.isFavorite ? `Saved ${payload.name} as a reusable route template.` : 'Removed route from favorites.')
    } catch (error) {
      setRecyclerLocationStatus(error.message || 'Could not update route favorite.')
    }
  }

  function handleLoadSavedRoute(route) {
    setRoutePlan({ routeId: route.id, createdAt: route.createdAt, totalDistanceKm: route.totalDistanceKm, stopCount: route.stopCount, orderedStops: route.orderedStops.map((stop) => ({ ...stop, id: stop.listingId })), isFavorite: route.isFavorite, name: route.name })
    setRecyclerCoordinates(route.start)
    setFilters((current) => ({ ...current, ...route.filters, radiusKm: String(route.filters?.radiusKm ?? current.radiusKm) }))
    setRecyclerLocationStatus(`Loaded saved route from ${formatTime(route.createdAt)}.`)
  }

  async function handleModerateListing(listingId, moderationStatus) {
    if (!authToken || currentUser?.role !== 'admin') return
    const adminNotes = window.prompt('Optional admin note for this moderation action:', '') ?? ''
    try {
      const response = await fetch(`/api/admin/listings/${listingId}/moderate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ moderationStatus, adminNotes }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Moderation failed.')
      setListings((current) => current.map((item) => (item.id === payload.id ? payload : item)))
      setAdminOverview((current) => current ? { ...current, listings: current.listings.map((item) => (item.id === payload.id ? payload : item)) } : current)
      setStatusMessage(`Listing moved to ${moderationStatus}.`)
    } catch (error) {
      setStatusMessage(error.message || 'Moderation failed.')
    }
  }
  return (
    <main className="app-shell">
      <section className="hero-panel">
        <article className="hero-copy">
          <span className="eyebrow">Circular marketplace</span>
          <h1>Urban Waste Exchange</h1>
          <p className="hero-text">A real-time waste-to-wealth platform where sellers publish recyclables, recyclers plan local pickups, and admins keep the marketplace trustworthy.</p>
          <div className="hero-stats">
            <article><strong>{summary.total}</strong><span>Total listings</span></article>
            <article><strong>{summary.available}</strong><span>Ready to claim</span></article>
            <article><strong>{summary.geoTagged}</strong><span>Geo-tagged supply</span></article>
          </div>
        </article>
        <aside className="impact-card">
          <span className="section-kicker">System status</span>
          <h2>Live exchange health</h2>
          <p>{statusMessage}</p>
          <ul>
            <li>{summary.claimed} listings are currently in pickup workflow.</li>
            <li>AI-assisted listing review helps sellers classify faster.</li>
            <li>Admins can flag or reject problematic marketplace entries.</li>
          </ul>
          {currentUser ? <div className="account-banner">Active session: {currentUser.name} ({currentUser.role}) {unreadNotifications ? `| ${unreadNotifications} unread notifications` : ''}</div> : null}
        </aside>
      </section>

      <section className="workspace-grid">
        <article className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Account</span><h2>Authenticate your role</h2></div><span className="status-pill">{authStatus || 'Sign in to publish or claim materials'}</span></div>
          {!currentUser ? (
            <div className="auth-card">
              <div className="auth-toggle">
                <button type="button" className={authMode === 'login' ? 'primary-button' : 'ghost-button'} onClick={() => setAuthMode('login')}>Login</button>
                <button type="button" className={authMode === 'register' ? 'primary-button' : 'ghost-button'} onClick={() => setAuthMode('register')}>Register</button>
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
            </div>
          ) : (
            <div className="session-card">
              <strong>{currentUser.name}</strong><span>{currentUser.email}</span><span>{currentUser.phone}</span><span>Role: {currentUser.role}</span>
              <button type="button" className="ghost-button" onClick={handleLogout}>Sign out</button>
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Seller flow</span><h2>Publish a recyclable listing</h2></div><span className="value-chip">{formatCurrency(estimatedPayout)} est. payout</span></div>
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
            <div className="ai-card"><div className="panel-heading"><div><span className="section-kicker">AI assist</span><h2>Waste image classification</h2></div>{imageMeta ? <span className="value-chip">{imageMeta.fileName} · {imageMeta.sizeKb} KB</span> : null}</div><p className="helper-line">Upload a photo, then let the assistant suggest a likely recyclable material before publishing.</p><div className="card-actions"><button type="button" className="secondary-button" onClick={handleAnalyzeWaste} disabled={classifyingImage || !listingForm.imageUrl || currentUser?.role !== 'seller'}>{classifyingImage ? 'Analyzing...' : 'Analyze image'}</button>{aiClassification ? <button type="button" className="ghost-button" onClick={handleApplyAiSuggestion}>Apply suggestion</button> : null}</div>{aiClassification ? <div className="ai-result-card"><strong>{aiClassification.suggestedMaterial}</strong><span>{aiClassification.suggestedFamily} · {Math.round(aiClassification.confidence * 100)}% confidence</span><p>{aiClassification.reason}</p>{aiClassification.alternatives?.length ? <div className="distance-strip">{aiClassification.alternatives.map((alternative) => <span key={alternative.material}>{alternative.material}</span>)}</div> : null}</div> : null}</div>
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Publishing...' : 'Publish listing'}</button>
          </form>
        </article>
      </section>
      <section className="workspace-grid">
        <article className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Recycler tools</span><h2>Nearby pickup planning</h2></div><span className="status-pill">{recyclerLocationStatus || 'Capture recycler location for nearby planning'}</span></div>
          <div className="filter-grid">
            <label>Search<input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search material, title, locality" /></label>
            <label>Material family<select value={filters.family} onChange={(event) => setFilters((current) => ({ ...current, family: event.target.value }))}>{families.map((family) => <option key={family} value={family}>{family}</option>)}</select></label>
            <label>Locality<select value={filters.locality} onChange={(event) => setFilters((current) => ({ ...current, locality: event.target.value }))}>{localities.map((locality) => <option key={locality} value={locality}>{locality}</option>)}</select></label>
            <label>Availability<select value={filters.availability} onChange={(event) => setFilters((current) => ({ ...current, availability: event.target.value }))}><option value="All">All</option><option value="available">Available</option><option value="claimed">Claimed</option><option value="completed">Completed</option></select></label>
            <label>Radius (km)<input type="number" min="1" max="50" value={filters.radiusKm} onChange={(event) => setFilters((current) => ({ ...current, radiusKm: event.target.value }))} /></label>
            <label>Nearby only<select value={filters.nearbyOnly ? 'yes' : 'no'} onChange={(event) => setFilters((current) => ({ ...current, nearbyOnly: event.target.value === 'yes' }))}><option value="no">No</option><option value="yes">Yes</option></select></label>
          </div>
          <div className="location-card recycler-location-card"><div className="location-card-header"><div><strong>Recycler live location</strong><p>Use current position for nearby filters, map radius, and route optimization.</p></div><button type="button" className="secondary-button" onClick={handleCaptureRecyclerLocation}>Capture recycler location</button></div></div>
          <div className="workflow-note"><strong>{routeCandidates.length}</strong><span>Listings are route-ready under the current recycler filters.</span><p className="route-helper">Route planning includes available listings plus any claimed pickups assigned to the signed-in recycler.</p></div>
          <button type="button" className="primary-button route-button" onClick={handleGenerateRoute}>Generate optimized route</button>
          {routePlan ? <div className="route-panel"><strong>{routePlan.name || 'Latest route plan'}</strong><span>{routePlan.stopCount} stops · {routePlan.totalDistanceKm} km total travel</span><div className="route-stops">{routePlan.orderedStops.map((stop, index) => <div key={`${stop.id || stop.listingId}-${index}`} className="route-stop"><strong>{index + 1}. {stop.title}</strong><span>{stop.addressLabel || `${stop.locality}, ${stop.city}`}</span><span>{stop.material} · {stop.legDistanceKm} km leg</span></div>)}</div></div> : null}
          <div className="saved-routes-panel">
            <div className="saved-routes-header"><strong>Saved route history</strong><span className="muted-text">{savedRoutesLoading ? 'Loading...' : `${savedRoutes.length} saved plans`}</span></div>
            {favoriteRoutes.length ? <div className="saved-routes-list">{favoriteRoutes.map((route) => <div key={`favorite-${route.id}`} className="saved-route-card favorite-route-card"><div className="saved-route-meta"><strong>{route.name}</strong><span>{route.stopCount} stops · {route.totalDistanceKm} km</span></div><div className="saved-route-actions"><button type="button" className="ghost-button saved-route-button" onClick={() => handleLoadSavedRoute(route)}>Load template</button><button type="button" className="ghost-button saved-route-button" onClick={() => handleToggleFavorite(route)}>Remove favorite</button></div></div>)}</div> : null}
            <div className="saved-routes-list">{savedRoutes.map((route) => <div key={route.id} className={`saved-route-card${route.isFavorite ? ' favorite-route-card' : ''}`}><div className="saved-route-meta"><strong>{route.name || formatTime(route.createdAt)}</strong><span>{route.stopCount} stops · {route.totalDistanceKm} km</span></div><span className="muted-text">Start: {route.start?.lat}, {route.start?.lng}</span><div className="saved-route-actions"><button type="button" className="ghost-button saved-route-button" onClick={() => handleLoadSavedRoute(route)}>Reopen route</button><button type="button" className="ghost-button saved-route-button" onClick={() => handleToggleFavorite(route)}>{route.isFavorite ? 'Unfavorite' : 'Favorite'}</button></div></div>)}</div>
          </div>
        </article>
        <article className="panel map-panel"><div className="panel-heading"><div><span className="section-kicker">Map view</span><h2>Marketplace geospatial feed</h2></div><span className="value-chip">{filteredListings.length} visible listings</span></div><MarketplaceMap listings={filteredListings} recyclerCoordinates={recyclerCoordinates} selectedRadiusKm={Number(filters.radiusKm) || 5} /></article>
      </section>

      {currentUser?.role === 'admin' ? (
        <section className="panel admin-panel">
          <div className="panel-heading"><div><span className="section-kicker">Admin</span><h2>Marketplace moderation dashboard</h2></div><span className="status-pill">{adminLoading ? 'Refreshing dashboard...' : 'Admin controls active'}</span></div>
          <div className="admin-metrics">
            <article className="admin-metric-card"><strong>{adminOverview?.metrics?.users?.total ?? 0}</strong><span>Registered users</span></article>
            <article className="admin-metric-card"><strong>{adminOverview?.metrics?.listings?.total ?? 0}</strong><span>Total listings</span></article>
            <article className="admin-metric-card"><strong>{adminOverview?.metrics?.listings?.flagged ?? 0}</strong><span>Flagged listings</span></article>
            <article className="admin-metric-card"><strong>{adminOverview?.metrics?.transactions?.confirmed ?? 0}</strong><span>Seller-confirmed receipts</span></article>
          </div>
          <div className="admin-grid">
            <div className="admin-card"><h3>Recent users</h3><div className="admin-list">{(adminOverview?.users ?? []).map((user) => <div key={user.id} className="admin-list-item"><strong>{user.name}</strong><span>{user.role} · {user.email}</span></div>)}</div></div>
            <div className="admin-card"><h3>Favorite routes</h3><div className="admin-list">{(adminOverview?.favoriteRoutes ?? []).map((route) => <div key={route.id} className="admin-list-item"><strong>{route.name || route.recyclerName}</strong><span>{route.recyclerName} · {route.stopCount} stops · {route.totalDistanceKm} km</span></div>)}</div></div>
          </div>
          <div className="admin-card"><h3>Listing moderation queue</h3><div className="admin-list">{(adminOverview?.listings ?? []).map((listing) => <div key={listing.id} className="listing-review-item"><div><strong>{listing.title}</strong><span>{listing.material} · {listing.locality}, {listing.city}</span><span>Moderation: {listing.moderationStatus}</span>{listing.aiClassification?.suggestedMaterial ? <span>AI suggested {listing.aiClassification.suggestedMaterial} at {Math.round((listing.aiClassification.confidence || 0) * 100)}%</span> : null}{listing.adminNotes ? <span>Note: {listing.adminNotes}</span> : null}</div><div className="saved-route-actions"><button type="button" className="ghost-button" onClick={() => handleModerateListing(listing.id, 'approved')}>Approve</button><button type="button" className="secondary-button" onClick={() => handleModerateListing(listing.id, 'flagged')}>Flag</button><button type="button" className="ghost-button" onClick={() => handleModerateListing(listing.id, 'rejected')}>Reject</button></div></div>)}</div></div>
        </section>
      ) : null}
      {currentUser ? (
        <section className="panel notification-panel">
          <div className="panel-heading"><div><span className="section-kicker">Inbox</span><h2>Notifications</h2></div><span className="status-pill">{notificationsLoading ? 'Loading...' : `${unreadNotifications} unread`}</span></div>
          <div className="notification-list">
            {notifications.length ? notifications.map((notification) => <div key={notification.id} className={`notification-card${notification.readAt ? ' notification-read' : ''}`}><div><strong>{notification.title}</strong><span>{notification.message}</span><span className="muted-text">{formatTime(notification.createdAt)}</span></div>{!notification.readAt ? <button type="button" className="ghost-button" onClick={() => handleMarkNotificationRead(notification.id)}>Mark read</button> : null}</div>) : <p className="muted-text">No notifications yet.</p>}
          </div>
        </section>
      ) : null}
      <section className="feed-section">
        <div className="feed-header"><div><span className="section-kicker">Marketplace feed</span><h2>Live recyclable listings</h2><p>Listings update in real time across sellers, recyclers, and admin moderation views.</p></div><span className="status-pill">{filteredListings.length} cards in view</span></div>
        <div className="listing-grid">
          {filteredListings.map((listing) => {
            const isClaimedByCurrentRecycler = currentUser?.role === 'recycler' && listing.claimedBy?.userId === currentUser.id
            const canClaim = currentUser?.role === 'recycler' && listing.status === 'available' && listing.moderationStatus !== 'rejected'
            const canComplete = currentUser?.role === 'recycler' && listing.status === 'claimed' && isClaimedByCurrentRecycler
            const canRecordTransaction = currentUser?.role === 'recycler' && isClaimedByCurrentRecycler && ['claimed', 'completed'].includes(listing.status)
            const canConfirmReceipt = currentUser?.role === 'seller' && listing.sellerId === currentUser.id && listing.transaction?.paymentStatus === 'paid' && !listing.transaction?.sellerConfirmedAt
            const canDownloadReceipt = Boolean(currentUser) && ((currentUser.role === 'seller' && listing.sellerId === currentUser.id) || (currentUser.role === 'recycler' && isClaimedByCurrentRecycler) || currentUser.role === 'admin') && listing.transaction && (listing.transaction.amount > 0 || listing.transaction.paymentStatus !== 'not_started')
            return <article key={listing.id} className="listing-card"><img src={listing.imageUrl} alt={listing.title} /><div className="listing-body"><div className="card-topline"><span className={`status-tag ${listing.status}`}>{listing.status}</span><span className={`status-tag moderation-${listing.moderationStatus}`}>{listing.moderationStatus}</span><span>{formatTime(listing.createdAt)}</span></div><h3>{listing.title}</h3><p className="location-line">{listing.addressLabel || `${listing.locality}, ${listing.city}`}</p><div className="listing-metrics"><span>{listing.material}</span><span>{listing.weightKg} kg</span><span>{formatCurrency(listing.estimatedValue)}</span></div><div className="distance-strip"><span>{listing.family}</span><span>{formatDistance(listing.computedDistanceKm)}</span></div>{listing.notes ? <p className="notes">{listing.notes}</p> : null}{listing.aiClassification?.suggestedMaterial ? <div className="ai-inline-note"><strong>AI match</strong><span>{listing.aiClassification.suggestedMaterial} · {Math.round((listing.aiClassification.confidence || 0) * 100)}%</span></div> : null}{listing.adminNotes ? <div className="ai-inline-note admin-inline-note"><strong>Admin note</strong><span>{listing.adminNotes}</span></div> : null}{listing.transaction && (listing.transaction.paymentStatus !== 'not_started' || listing.transaction.amount > 0) ? <div className="ai-inline-note transaction-inline-note"><strong>Transaction</strong><span>{formatCurrency(listing.transaction.amount || 0)} | {formatTransactionLabel(listing.transaction.paymentMethod || 'cash')} | {formatTransactionLabel(listing.transaction.paymentStatus || 'not_started')}</span>{listing.transaction.notes ? <span>{listing.transaction.notes}</span> : null}{listing.transaction.sellerConfirmedAt ? <span>Seller confirmed on {formatTime(listing.transaction.sellerConfirmedAt)}</span> : null}</div> : null}{listing.status !== 'available' ? <div className={`contact-block${listing.claimedBy ? '' : ' muted'}`}><strong>Pickup contact</strong>{listing.claimedBy ? <><span>{listing.claimedBy.name}</span><span>{listing.claimedBy.phone}</span></> : <span>Claimed contact details will appear here.</span>}</div> : null}<div className="card-actions"><button type="button" className="secondary-button" onClick={() => handleClaim(listing.id)} disabled={!canClaim || activeClaimId === listing.id}>{activeClaimId === listing.id ? 'Claiming...' : 'Claim listing'}</button>{canComplete ? <button type="button" className="ghost-button" onClick={() => handleComplete(listing.id)}>Mark completed</button> : null}{canRecordTransaction ? <button type="button" className="ghost-button" onClick={() => handleRecordTransaction(listing)}>Record payment</button> : null}{canConfirmReceipt ? <button type="button" className="ghost-button" onClick={() => handleConfirmReceipt(listing)}>Confirm receipt</button> : null}{canDownloadReceipt ? <button type="button" className="ghost-button" onClick={() => handleDownloadReceipt(listing)}>Download receipt</button> : null}</div></div></article>
          })}
        </div>
      </section>
    </main>
  )
}

export default App

