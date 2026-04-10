import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import mongoose from 'mongoose'
import { connectDatabase } from './db.js'
import { Listing } from './models/Listing.js'
import { RoutePlan } from './models/RoutePlan.js'
import { Notification } from './models/Notification.js'
import { User } from './models/User.js'
import { seedListings } from './seed.js'

const PORT = process.env.PORT || 4000
const JWT_SECRET = process.env.JWT_SECRET || 'urban-exchange-dev-secret'
const GEOCODER_USER_AGENT = process.env.GEOCODER_USER_AGENT || 'urban-waste-exchange-demo/1.0'
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const materialRates = {
  'PET Plastic': 18,
  'HDPE Plastic': 24,
  Cardboard: 12,
  Newspaper: 10,
  Aluminum: 95,
  Steel: 28,
  Copper: 620,
  'Mixed E-Waste': 55,
}

const materialFamilies = {
  'PET Plastic': 'Plastic',
  'HDPE Plastic': 'Plastic',
  Cardboard: 'Paper',
  Newspaper: 'Paper',
  Aluminum: 'Metal',
  Steel: 'Metal',
  Copper: 'Metal',
  'Mixed E-Waste': 'E-Waste',
}

const classificationRules = {
  'PET Plastic': ['pet', 'bottle', 'bottles', 'soft drink', 'water bottle', 'plastic bottle'],
  'HDPE Plastic': ['hdpe', 'detergent', 'shampoo', 'container', 'milk jug', 'canister'],
  Cardboard: ['cardboard', 'carton', 'box', 'boxes', 'packaging'],
  Newspaper: ['newspaper', 'paper', 'magazine', 'flyer', 'documents'],
  Aluminum: ['aluminium', 'aluminum', 'can', 'cans', 'foil'],
  Steel: ['steel', 'tin', 'scrap metal', 'utensil', 'rod'],
  Copper: ['copper', 'wire', 'cable', 'coil'],
  'Mixed E-Waste': ['e-waste', 'ewaste', 'charger', 'router', 'keyboard', 'laptop', 'electronics', 'electronic'],
}

const transactionMethods = ['cash', 'bank_transfer', 'cheque']
const transactionStatuses = ['not_started', 'pending', 'paid']

const fallbackImage =
  'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=80'

const corsOptions = {
  origin(origin, callback) {
    if (!origin || FRONTEND_ORIGINS.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new Error('Origin not allowed by CORS'))
  },
}

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_ORIGINS,
  },
})

app.use(cors(corsOptions))
app.use(express.json({ limit: '8mb' }))

function parseNumber(value) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function reverseGeocode(lat, lng) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', lat)
  url.searchParams.set('lon', lng)
  url.searchParams.set('addressdetails', '1')

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': GEOCODER_USER_AGENT,
    },
  })

  if (!response.ok) {
    throw new Error('Reverse geocoding failed.')
  }

  const payload = await response.json()
  const address = payload.address || {}

  return {
    locality:
      address.suburb ||
      address.neighbourhood ||
      address.residential ||
      address.quarter ||
      address.village ||
      address.town ||
      address.city_district ||
      '',
    city: address.city || address.town || address.county || address.state_district || '',
    addressLabel: payload.display_name || '',
  }
}

function calculateDistanceKm(from, to) {
  const earthRadiusKm = 6371
  const dLat = ((to.lat - from.lat) * Math.PI) / 180
  const dLng = ((to.lng - from.lng) * Math.PI) / 180
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function buildOptimizedRoute(start, listings) {
  const remaining = [...listings]
  const orderedStops = []
  let current = { ...start }
  let totalDistanceKm = 0

  while (remaining.length > 0) {
    let nearestIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY

    remaining.forEach((listing, index) => {
      const distance = calculateDistanceKm(current, listing.coordinates)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })

    const nextStop = remaining.splice(nearestIndex, 1)[0]
    totalDistanceKm += nearestDistance
    orderedStops.push({
      ...nextStop,
      legDistanceKm: Number(nearestDistance.toFixed(2)),
    })
    current = nextStop.coordinates
  }

  return {
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    stopCount: orderedStops.length,
    orderedStops,
  }
}

function buildDistanceStages(query) {
  const lat = parseNumber(query.lat)
  const lng = parseNumber(query.lng)
  const radiusKm = parseNumber(query.radiusKm)

  if (lat == null || lng == null) {
    return null
  }

  const geoNear = {
    $geoNear: {
      near: {
        type: 'Point',
        coordinates: [lng, lat],
      },
      distanceField: 'distanceMeters',
      spherical: true,
    },
  }

  if (radiusKm != null && radiusKm > 0) {
    geoNear.$geoNear.maxDistance = radiusKm * 1000
  }

  return [
    geoNear,
    {
      $addFields: {
        distanceKm: {
          $round: [{ $divide: ['$distanceMeters', 1000] }, 2],
        },
      },
    },
    {
      $project: {
        distanceMeters: 0,
      },
    },
  ]
}

function buildListingFilters(query, options = {}) {
  const filters = {}

  if (!options.includeRejected) {
    filters.moderationStatus = { $ne: 'rejected' }
  }

  if (query.family && query.family !== 'All') {
    filters.family = query.family
  }

  if (query.locality && query.locality !== 'All') {
    filters.locality = query.locality
  }

  if (query.status && query.status !== 'All') {
    filters.status = query.status
  }

  if (query.search?.trim()) {
    const regex = new RegExp(query.search.trim(), 'i')
    filters.$or = [
      { title: regex },
      { material: regex },
      { locality: regex },
      { city: regex },
      { addressLabel: regex },
    ]
  }

  return filters
}

function normalizeListing(document) {
  const listing = document.toJSON ? document.toJSON() : document

  if (listing._id && !listing.id) {
    listing.id = listing._id.toString()
    delete listing._id
  }

  return listing
}

function normalizeRoutePlan(document) {
  const routePlan = document.toJSON ? document.toJSON() : document

  if (routePlan._id && !routePlan.id) {
    routePlan.id = routePlan._id.toString()
    delete routePlan._id
  }

  return routePlan
}

function normalizeNotification(document) {
  const notification = document.toJSON ? document.toJSON() : document

  if (notification._id && !notification.id) {
    notification.id = notification._id.toString()
    delete notification._id
  }

  return notification
}

async function createNotification({ userId, listingId = null, type, title, message }) {
  if (!userId) return null

  const notification = await Notification.create({
    userId,
    listingId,
    type,
    title,
    message,
  })

  const payload = normalizeNotification(notification)
  io.emit('notification:created', payload)
  return payload
}

function buildTransactionReceipt(listing) {
  const transaction = listing.transaction || {}
  const locationLabel = listing.addressLabel || `${listing.locality}, ${listing.city}`
  const recyclerLabel = listing.claimedBy?.name || 'Not assigned'
  const recyclerPhone = listing.claimedBy?.phone ? ` (${listing.claimedBy.phone})` : ''
  const lines = [
    'Urban Waste Exchange Receipt',
    '============================',
    'Receipt generated: ' + new Date().toLocaleString('en-IN'),
    '',
    'Listing: ' + listing.title,
    'Material: ' + listing.material,
    'Weight: ' + listing.weightKg + ' kg',
    'Location: ' + locationLabel,
    '',
    'Seller: ' + listing.sellerName + ' (' + listing.sellerPhone + ')',
    'Recycler: ' + recyclerLabel + recyclerPhone,
    '',
    'Amount: INR ' + Number(transaction.amount || 0).toFixed(0),
    'Payment method: ' + String(transaction.paymentMethod || 'cash').replaceAll('_', ' '),
    'Payment status: ' + String(transaction.paymentStatus || 'not_started').replaceAll('_', ' '),
    'Recorded at: ' + (transaction.recordedAt ? new Date(transaction.recordedAt).toLocaleString('en-IN') : 'Not recorded'),
    'Recorded by: ' + (transaction.recordedBy?.name || 'Not recorded'),
    'Seller confirmed: ' + (transaction.sellerConfirmedAt ? new Date(transaction.sellerConfirmedAt).toLocaleString('en-IN') : 'Pending confirmation'),
    'Seller confirmer: ' + (transaction.sellerConfirmedBy?.name || 'Pending confirmation'),
    transaction.notes ? 'Notes: ' + transaction.notes : '',
  ]

  return lines.filter(Boolean).join('\n')
}
function classifyWaste(input = {}) {
  const searchableText = [input.fileName, input.title, input.notes, input.imageUrl]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const ranked = Object.entries(classificationRules)
    .map(([material, keywords]) => {
      const score = keywords.reduce((total, keyword) => total + (searchableText.includes(keyword) ? 1 : 0), 0)
      return {
        material,
        family: materialFamilies[material],
        score,
        keywords: keywords.filter((keyword) => searchableText.includes(keyword)),
      }
    })
    .sort((left, right) => right.score - left.score)

  const topHit = ranked[0]
  const fallbackMaterial = 'Mixed E-Waste'
  const suggestedMaterial = topHit?.score > 0 ? topHit.material : fallbackMaterial
  const confidenceBase = topHit?.score > 0 ? Math.min(0.45 + topHit.score * 0.12, 0.94) : 0.38

  return {
    suggestedMaterial,
    suggestedFamily: materialFamilies[suggestedMaterial],
    confidence: Number(confidenceBase.toFixed(2)),
    reason:
      topHit?.score > 0
        ? `Matched keywords: ${topHit.keywords.join(', ')}`
        : 'No strong keyword matches were found, so the classifier chose the safest fallback category.',
    alternatives: ranked
      .filter((candidate) => candidate.material !== suggestedMaterial)
      .slice(0, 3)
      .map((candidate) => ({
        material: candidate.material,
        family: candidate.family,
      })),
  }
}

function createToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  )
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization

  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required.' })
  }

  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, JWT_SECRET)
    const user = await User.findById(payload.sub)

    if (!user) {
      return res.status(401).json({ message: 'Session is no longer valid.' })
    }

    req.user = user
    return next()
  } catch {
    return res.status(401).json({ message: 'Invalid authentication token.' })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have access to this action.' })
    }

    return next()
  }
}

async function queryListings(query = {}, options = {}) {
  const filters = buildListingFilters(query, options)
  const distanceStages = buildDistanceStages(query)

  if (distanceStages) {
    const listings = await Listing.aggregate([
      ...distanceStages,
      { $match: filters },
      { $sort: { distanceKm: 1, createdAt: -1 } },
    ])

    return listings.map((listing) => normalizeListing(listing))
  }

  const listings = await Listing.find(filters).sort({ createdAt: -1 }).lean(false)
  return listings.map((listing) => normalizeListing(listing))
}

app.post('/api/auth/register', async (req, res, next) => {
  const { name, email, phone, password, role } = req.body

  if (!name || !email || !phone || !password || !role) {
    return res.status(400).json({ message: 'All registration fields are required.' })
  }

  if (!['seller', 'recycler', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role selected.' })
  }

  try {
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() })

    if (existingUser) {
      return res.status(409).json({ message: 'An account with that email already exists.' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await User.create({
      name,
      email: email.toLowerCase().trim(),
      phone,
      role,
      passwordHash,
    })

    const payload = user.toJSON()
    const token = createToken(payload)
    return res.status(201).json({ token, user: payload })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/auth/login', async (req, res, next) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' })
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() })

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash)

    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    const payload = user.toJSON()
    const token = createToken(payload)
    return res.json({ token, user: payload })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user.toJSON() })
})

app.get('/api/notifications/my', authenticate, async (req, res, next) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '20', 10) || 20, 1), 100)
  const unreadOnly = req.query.unreadOnly === 'true'

  try {
    const filters = { userId: req.user._id }

    if (unreadOnly) {
      filters.readAt = null
    }

    const notifications = await Notification.find(filters).sort({ createdAt: -1 }).limit(limit).lean(false)
    return res.json(notifications.map((notification) => normalizeNotification(notification)))
  } catch (error) {
    return next(error)
  }
})

app.patch('/api/notifications/:id/read', authenticate, async (req, res, next) => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ message: 'Notification not found.' })
  }

  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true },
    )

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found.' })
    }

    return res.json(normalizeNotification(notification))
  } catch (error) {
    return next(error)
  }
})

app.get('/api/geocode/reverse', async (req, res, next) => {
  const lat = parseNumber(req.query.lat)
  const lng = parseNumber(req.query.lng)

  if (lat == null || lng == null) {
    return res.status(400).json({ message: 'lat and lng are required.' })
  }

  try {
    const result = await reverseGeocode(lat, lng)
    return res.json(result)
  } catch (error) {
    return next(error)
  }
})

app.post('/api/classify-waste', authenticate, requireRole('seller', 'admin'), async (req, res) => {
  const classification = classifyWaste(req.body)
  res.json(classification)
})

app.get('/api/admin/overview', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const [users, listings, routes] = await Promise.all([
      User.find().sort({ createdAt: -1 }).limit(8).lean(false),
      Listing.find().sort({ createdAt: -1 }).limit(8).lean(false),
      RoutePlan.find({ isFavorite: true }).sort({ updatedAt: -1 }).limit(6).lean(false),
    ])

    const metrics = {
      users: {
        total: await User.countDocuments(),
        sellers: await User.countDocuments({ role: 'seller' }),
        recyclers: await User.countDocuments({ role: 'recycler' }),
        admins: await User.countDocuments({ role: 'admin' }),
      },
      listings: {
        total: await Listing.countDocuments(),
        available: await Listing.countDocuments({ status: 'available' }),
        flagged: await Listing.countDocuments({ moderationStatus: 'flagged' }),
        rejected: await Listing.countDocuments({ moderationStatus: 'rejected' }),
      },
      routes: {
        saved: await RoutePlan.countDocuments(),
        favorites: await RoutePlan.countDocuments({ isFavorite: true }),
      },
      transactions: {
        pending: await Listing.countDocuments({ 'transaction.paymentStatus': 'pending' }),
        paid: await Listing.countDocuments({ 'transaction.paymentStatus': 'paid' }),
      },
    }

    return res.json({
      metrics,
      users: users.map((user) => user.toJSON()),
      listings: listings.map((listing) => normalizeListing(listing)),
      favoriteRoutes: routes.map((route) => normalizeRoutePlan(route)),
    })
  } catch (error) {
    return next(error)
  }
})

app.patch('/api/admin/listings/:id/moderate', authenticate, requireRole('admin'), async (req, res, next) => {
  const { id } = req.params
  const { moderationStatus, adminNotes = '' } = req.body

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ message: 'Listing not found.' })
  }

  if (!['approved', 'flagged', 'rejected'].includes(moderationStatus)) {
    return res.status(400).json({ message: 'Invalid moderation status.' })
  }

  try {
    const listing = await Listing.findByIdAndUpdate(
      id,
      {
        $set: {
          moderationStatus,
          adminNotes: String(adminNotes).trim(),
        },
      },
      { new: true },
    )

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found.' })
    }

    const payload = normalizeListing(listing)
    await createNotification({
      userId: listing.sellerId,
      listingId: listing._id,
      type: 'moderation_updated',
      title: 'Listing moderation updated',
      message: `Your listing "${listing.title}" was marked as ${moderationStatus}.`,
    })
    io.emit('listing:updated', payload)
    return res.json(payload)
  } catch (error) {
    return next(error)
  }
})
app.get('/api/routes/my', authenticate, requireRole('recycler'), async (req, res, next) => {
  try {
    const routes = await RoutePlan.find({ recyclerId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(false)

    return res.json(routes.map((route) => normalizeRoutePlan(route)))
  } catch (error) {
    return next(error)
  }
})

app.patch('/api/routes/:id/favorite', authenticate, requireRole('recycler'), async (req, res, next) => {
  const { id } = req.params
  const { name = '', isFavorite = true } = req.body

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ message: 'Route not found.' })
  }

  try {
    const route = await RoutePlan.findOneAndUpdate(
      { _id: id, recyclerId: req.user._id },
      {
        $set: {
          isFavorite,
          name: isFavorite ? String(name).trim() || 'Favorite route' : '',
        },
      },
      { new: true },
    )

    if (!route) {
      return res.status(404).json({ message: 'Route not found.' })
    }

    return res.json(normalizeRoutePlan(route))
  } catch (error) {
    return next(error)
  }
})

app.post('/api/routes/optimize', authenticate, requireRole('recycler'), async (req, res, next) => {
  const { start, listingIds = [], filters = {} } = req.body

  if (start?.lat == null || start?.lng == null) {
    return res.status(400).json({ message: 'Start coordinates are required.' })
  }

  if (!Array.isArray(listingIds) || listingIds.length === 0) {
    return res.status(400).json({ message: 'At least one listing id is required.' })
  }

  try {
    const validIds = listingIds.filter((id) => mongoose.isValidObjectId(id))
    const listings = await Listing.find({
      _id: { $in: validIds },
      moderationStatus: { $ne: 'rejected' },
      $or: [{ status: 'available' }, { status: 'claimed', 'claimedBy.userId': req.user._id }],
    }).lean()
    const routeCandidates = listings
      .filter((listing) => listing.coordinates?.lat != null && listing.coordinates?.lng != null)
      .map((listing) => normalizeListing(listing))

    if (routeCandidates.length === 0) {
      return res.status(404).json({
        message: 'No route-ready listings were found for this recycler.',
      })
    }

    const route = buildOptimizedRoute(
      { lat: Number(start.lat), lng: Number(start.lng) },
      routeCandidates,
    )

    const savedRoute = await RoutePlan.create({
      recyclerId: req.user._id,
      recyclerName: req.user.name,
      start: {
        lat: Number(start.lat),
        lng: Number(start.lng),
      },
      totalDistanceKm: route.totalDistanceKm,
      stopCount: route.stopCount,
      orderedStops: route.orderedStops.map((stop) => ({
        listingId: stop.id,
        title: stop.title,
        material: stop.material,
        family: stop.family,
        status: stop.status,
        locality: stop.locality,
        city: stop.city,
        addressLabel: stop.addressLabel,
        estimatedValue: stop.estimatedValue,
        legDistanceKm: stop.legDistanceKm,
        coordinates: stop.coordinates,
      })),
      filters: {
        search: typeof filters.search === 'string' ? filters.search : '',
        family: typeof filters.family === 'string' ? filters.family : 'All',
        locality: typeof filters.locality === 'string' ? filters.locality : 'All',
        availability: typeof filters.availability === 'string' ? filters.availability : 'All',
        nearbyOnly: Boolean(filters.nearbyOnly),
        radiusKm: parseNumber(filters.radiusKm) ?? 5,
      },
    })

    return res.json({
      ...route,
      routeId: savedRoute.id,
      createdAt: savedRoute.createdAt,
    })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/meta', (_req, res) => {
  res.json({
    materials: Object.entries(materialFamilies).map(([name, family]) => ({
      name,
      family,
      ratePerKg: materialRates[name],
    })),
  })
})

app.get('/api/listings', async (req, res, next) => {
  try {
    const includeRejected = req.query.includeRejected === 'true'
    const listings = await queryListings(req.query, { includeRejected })
    res.json(listings)
  } catch (error) {
    next(error)
  }
})

app.post('/api/listings', authenticate, requireRole('seller'), async (req, res, next) => {
  const {
    title,
    material,
    weightKg,
    locality,
    city,
    imageUrl,
    notes,
    coordinates,
    addressLabel,
    aiClassification,
  } = req.body

  if (!title || !material || !weightKg || coordinates?.lat == null || coordinates?.lng == null) {
    return res.status(400).json({ message: 'Missing required listing fields.' })
  }

  try {
    const rate = materialRates[material] ?? 20
    let resolvedLocation = {
      locality: locality || '',
      city: city || '',
      addressLabel: addressLabel || '',
    }

    if (!resolvedLocation.locality || !resolvedLocation.city || !resolvedLocation.addressLabel) {
      try {
        const geocoded = await reverseGeocode(coordinates.lat, coordinates.lng)
        resolvedLocation = {
          locality: resolvedLocation.locality || geocoded.locality || 'Unknown locality',
          city: resolvedLocation.city || geocoded.city || 'Unknown city',
          addressLabel: resolvedLocation.addressLabel || geocoded.addressLabel || '',
        }
      } catch {
        resolvedLocation = {
          locality: resolvedLocation.locality || 'Unknown locality',
          city: resolvedLocation.city || 'Unknown city',
          addressLabel: resolvedLocation.addressLabel,
        }
      }
    }

    const listing = await Listing.create({
      sellerId: req.user._id,
      sellerName: req.user.name,
      sellerPhone: req.user.phone,
      title,
      material,
      family: materialFamilies[material] ?? 'Other',
      weightKg: Number(weightKg),
      locality: resolvedLocation.locality,
      city: resolvedLocation.city,
      addressLabel: resolvedLocation.addressLabel,
      imageUrl: imageUrl || fallbackImage,
      notes,
      estimatedValue: Math.round(Number(weightKg) * rate),
      status: 'available',
      moderationStatus: 'approved',
      adminNotes: '',
      aiClassification: aiClassification
        ? {
            suggestedMaterial: aiClassification.suggestedMaterial || '',
            suggestedFamily: aiClassification.suggestedFamily || '',
            confidence: Number(aiClassification.confidence) || 0,
            reason: aiClassification.reason || '',
            analyzedAt: new Date(),
          }
        : null,
      claimedBy: null,
      coordinates: {
        lat: Number(coordinates.lat),
        lng: Number(coordinates.lng),
      },
    })

    const payload = normalizeListing(listing)
    io.emit('listing:created', payload)

    return res.status(201).json(payload)
  } catch (error) {
    return next(error)
  }
})

app.patch('/api/listings/:id/claim', authenticate, requireRole('recycler'), async (req, res, next) => {
  const { id } = req.params
  const { pickupTime } = req.body

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ message: 'Listing not found.' })
  }

  if (!pickupTime) {
    return res.status(400).json({ message: 'Pickup time is required when claiming a listing.' })
  }

  const pickupDate = new Date(pickupTime)

  if (Number.isNaN(pickupDate.getTime())) {
    return res.status(400).json({ message: 'Pickup time must be a valid date and time.' })
  }

  try {
    const listing = await Listing.findOneAndUpdate(
      { _id: id, status: 'available', moderationStatus: { $ne: 'rejected' } },
      {
        $set: {
          status: 'claimed',
          claimedBy: {
            userId: req.user._id,
            name: req.user.name,
            phone: req.user.phone,
            claimedAt: new Date(),
            pickupTime: pickupDate,
          },
        },
      },
      { new: true },
    )

    if (!listing) {
      const exists = await Listing.exists({ _id: id })
      const message = exists ? 'Listing is no longer available.' : 'Listing not found.'
      return res.status(exists ? 409 : 404).json({ message })
    }

    const payload = normalizeListing(listing)
    await createNotification({
      userId: listing.sellerId,
      listingId: listing._id,
      type: 'listing_claimed',
      title: 'Listing claimed',
      message: `${req.user.name} claimed your listing "${listing.title}" for pickup at ${pickupDate.toLocaleString('en-IN')}.`,
    })
    io.emit('listing:updated', payload)
    return res.json(payload)
  } catch (error) {
    return next(error)
  }
})
app.patch('/api/listings/:id/complete', authenticate, requireRole('recycler'), async (req, res, next) => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ message: 'Listing not found.' })
  }

  try {
    const listing = await Listing.findOneAndUpdate(
      { _id: id, 'claimedBy.userId': req.user._id },
      { $set: { status: 'completed', 'transaction.paymentStatus': 'pending' } },
      { new: true },
    )

    if (!listing) {
      return res.status(403).json({ message: 'Only the recycler who claimed this listing can complete it.' })
    }

    const payload = normalizeListing(listing)
    await createNotification({
      userId: listing.sellerId,
      listingId: listing._id,
      type: 'pickup_completed',
      title: 'Pickup completed',
      message: `${req.user.name} marked pickup complete for "${listing.title}". Payment is now pending settlement.`,
    })
    io.emit('listing:updated', payload)
    return res.json(payload)
  } catch (error) {
    return next(error)
  }
})
app.patch('/api/listings/:id/transaction', authenticate, requireRole('recycler'), async (req, res, next) => {
  const { id } = req.params
  const { amount, paymentMethod, paymentStatus, notes = '' } = req.body

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ message: 'Listing not found.' })
  }

  const parsedAmount = parseNumber(amount)

  if (parsedAmount == null || parsedAmount < 0) {
    return res.status(400).json({ message: 'A valid transaction amount is required.' })
  }

  if (!transactionMethods.includes(paymentMethod)) {
    return res.status(400).json({ message: 'Invalid transaction method.' })
  }

  if (!transactionStatuses.includes(paymentStatus)) {
    return res.status(400).json({ message: 'Invalid transaction status.' })
  }

  try {
    const listing = await Listing.findOneAndUpdate(
      {
        _id: id,
        'claimedBy.userId': req.user._id,
        status: { $in: ['claimed', 'completed'] },
      },
      {
        $set: {
          'transaction.amount': parsedAmount,
          'transaction.paymentMethod': paymentMethod,
          'transaction.paymentStatus': paymentStatus,
          'transaction.notes': String(notes).trim(),
          'transaction.recordedAt': new Date(),
          'transaction.recordedBy': {
            userId: req.user._id,
            name: req.user.name,
          },
          'transaction.sellerConfirmedAt': null,
          'transaction.sellerConfirmedBy': null,
        },
      },
      { new: true },
    )

    if (!listing) {
      return res.status(403).json({ message: 'Only the assigned recycler can record this transaction.' })
    }

    const payload = normalizeListing(listing)
    await createNotification({
      userId: listing.sellerId,
      listingId: listing._id,
      type: 'payment_recorded',
      title: 'Payment recorded',
      message: `${req.user.name} recorded a ${paymentStatus.replaceAll('_', ' ')} payment for "${listing.title}".`,
    })
    io.emit('listing:updated', payload)
    return res.json(payload)
  } catch (error) {
    return next(error)
  }
})
app.patch('/api/listings/:id/transaction/confirm', authenticate, requireRole('seller'), async (req, res, next) => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ message: 'Listing not found.' })
  }

  try {
    const listing = await Listing.findOneAndUpdate(
      {
        _id: id,
        sellerId: req.user._id,
        'transaction.paymentStatus': 'paid',
      },
      {
        $set: {
          'transaction.sellerConfirmedAt': new Date(),
          'transaction.sellerConfirmedBy': {
            userId: req.user._id,
            name: req.user.name,
          },
        },
      },
      { new: true },
    )

    if (!listing) {
      return res.status(403).json({ message: 'Only the seller can confirm a paid transaction for this listing.' })
    }

    const payload = normalizeListing(listing)
    if (listing.claimedBy?.userId) {
      await createNotification({
        userId: listing.claimedBy.userId,
        listingId: listing._id,
        type: 'receipt_confirmed',
        title: 'Receipt confirmed',
        message: `${req.user.name} confirmed receipt for "${listing.title}".`,
      })
    }
    io.emit('listing:updated', payload)
    return res.json(payload)
  } catch (error) {
    return next(error)
  }
})
app.get('/api/listings/:id/receipt', authenticate, async (req, res, next) => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ message: 'Listing not found.' })
  }

  try {
    const listing = await Listing.findById(id)

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found.' })
    }

    const isSeller = listing.sellerId?.toString() === req.user._id.toString()
    const isAssignedRecycler = listing.claimedBy?.userId?.toString() === req.user._id.toString()
    const isAdmin = req.user.role === 'admin'

    if (!isSeller && !isAssignedRecycler && !isAdmin) {
      return res.status(403).json({ message: 'You do not have access to this receipt.' })
    }

    if (!listing.transaction || ((listing.transaction.amount || 0) <= 0 && listing.transaction.paymentStatus === 'not_started')) {
      return res.status(400).json({ message: 'No transaction receipt is available for this listing yet.' })
    }

    const filename = `urban-waste-receipt-${listing.id}.txt`
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(buildTransactionReceipt(normalizeListing(listing)))
  } catch (error) {
    return next(error)
  }
})
io.on('connection', async (socket) => {
  try {
    const listings = await queryListings()
    socket.emit('sync', listings)
  } catch (error) {
    console.error('Socket sync failed')
    console.error(error)
  }
})

app.use((error, _req, res, next) => {
  void next
  console.error(error)
  res.status(500).json({ message: 'Internal server error.' })
})

async function seedDatabase() {
  const listingCount = await Listing.countDocuments()

  if (listingCount === 0) {
    await Listing.insertMany(seedListings)
    return
  }

  const needsCoordinates = await Listing.countDocuments({
    $or: [{ coordinates: { $exists: false } }, { geoLocation: { $exists: false } }],
  })

  if (needsCoordinates > 0) {
    await Listing.deleteMany({})
    await Listing.insertMany(seedListings)
  }
}

async function startServer() {
  await connectDatabase(process.env.MONGO_URI)
  await seedDatabase()

  httpServer.listen(PORT, () => {
    console.log(`Urban Waste Exchange API listening on http://localhost:${PORT}`)
  })
}

startServer().catch((error) => {
  console.error('Failed to start Urban Waste Exchange API')
  console.error(error)
  process.exit(1)
})






