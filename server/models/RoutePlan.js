import mongoose from 'mongoose'

const coordinatesSchema = new mongoose.Schema(
  {
    lat: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    lng: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
  },
  { _id: false },
)

const routeStopSchema = new mongoose.Schema(
  {
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    material: {
      type: String,
      required: true,
      trim: true,
    },
    family: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['available', 'claimed', 'completed'],
      required: true,
    },
    locality: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    addressLabel: {
      type: String,
      trim: true,
      default: '',
    },
    estimatedValue: {
      type: Number,
      min: 0,
      default: 0,
    },
    legDistanceKm: {
      type: Number,
      required: true,
      min: 0,
    },
    coordinates: {
      type: coordinatesSchema,
      required: true,
    },
  },
  { _id: false },
)

const routePlanSchema = new mongoose.Schema(
  {
    recyclerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recyclerName: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    isFavorite: {
      type: Boolean,
      default: false,
    },
    start: {
      type: coordinatesSchema,
      required: true,
    },
    totalDistanceKm: {
      type: Number,
      required: true,
      min: 0,
    },
    stopCount: {
      type: Number,
      required: true,
      min: 0,
    },
    orderedStops: {
      type: [routeStopSchema],
      default: [],
    },
    filters: {
      search: {
        type: String,
        trim: true,
        default: '',
      },
      family: {
        type: String,
        trim: true,
        default: 'All',
      },
      locality: {
        type: String,
        trim: true,
        default: 'All',
      },
      availability: {
        type: String,
        trim: true,
        default: 'All',
      },
      nearbyOnly: {
        type: Boolean,
        default: false,
      },
      radiusKm: {
        type: Number,
        default: 5,
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        ret.id = ret._id.toString()
        delete ret._id
        ret.recyclerId = ret.recyclerId.toString()
        ret.orderedStops = ret.orderedStops.map((stop) => ({
          ...stop,
          listingId: stop.listingId.toString(),
        }))
        return ret
      },
    },
  },
)

routePlanSchema.index({ recyclerId: 1, createdAt: -1 })

export const RoutePlan = mongoose.model('RoutePlan', routePlanSchema)

