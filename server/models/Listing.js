import mongoose from 'mongoose'

const claimedBySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    name: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    claimedAt: {
      type: Date,
    },
    pickupTime: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
)

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

const geoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: 'Location coordinates must be [lng, lat].',
      },
    },
  },
  { _id: false },
)

const aiClassificationSchema = new mongoose.Schema(
  {
    suggestedMaterial: {
      type: String,
      trim: true,
      default: '',
    },
    suggestedFamily: {
      type: String,
      trim: true,
      default: '',
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    analyzedAt: {
      type: Date,
    },
  },
  { _id: false },
)

const transactionSchema = new mongoose.Schema(
  {
    paymentMethod: {
      type: String,
      enum: ['cash', 'bank_transfer', 'cheque'],
      default: 'cash',
    },
    paymentStatus: {
      type: String,
      enum: ['not_started', 'pending', 'paid'],
      default: 'not_started',
    },
    amount: {
      type: Number,
      min: 0,
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    recordedAt: {
      type: Date,
      default: null,
    },
    recordedBy: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      name: {
        type: String,
        trim: true,
        default: '',
      },
    },
    sellerConfirmedAt: {
      type: Date,
      default: null,
    },
    sellerConfirmedBy: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      name: {
        type: String,
        trim: true,
        default: '',
      },
    },
  },
  { _id: false },
)

const listingSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    sellerName: {
      type: String,
      required: true,
      trim: true,
    },
    sellerPhone: {
      type: String,
      required: true,
      trim: true,
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
    weightKg: {
      type: Number,
      required: true,
      min: 0.1,
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
    imageUrl: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
      default: 'No extra handling notes provided.',
    },
    estimatedValue: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['available', 'claimed', 'completed'],
      default: 'available',
    },
    moderationStatus: {
      type: String,
      enum: ['approved', 'flagged', 'rejected'],
      default: 'approved',
    },
    adminNotes: {
      type: String,
      trim: true,
      default: '',
    },
    aiClassification: {
      type: aiClassificationSchema,
      default: null,
    },
    transaction: {
      type: transactionSchema,
      default: () => ({
        paymentMethod: 'cash',
        paymentStatus: 'not_started',
        amount: 0,
        notes: '',
        recordedAt: null,
        recordedBy: null,
        sellerConfirmedAt: null,
        sellerConfirmedBy: null,
      }),
    },
    claimedBy: {
      type: claimedBySchema,
      default: null,
    },
    coordinates: {
      type: coordinatesSchema,
      required: true,
    },
    geoLocation: {
      type: geoPointSchema,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.geoLocation
        if (ret.claimedBy?.userId) {
          ret.claimedBy.userId = ret.claimedBy.userId.toString()
        }
        if (ret.sellerId) {
          ret.sellerId = ret.sellerId.toString()
        }
        if (ret.transaction?.recordedBy?.userId) {
          ret.transaction.recordedBy.userId = ret.transaction.recordedBy.userId.toString()
        }
        if (ret.transaction?.sellerConfirmedBy?.userId) {
          ret.transaction.sellerConfirmedBy.userId = ret.transaction.sellerConfirmedBy.userId.toString()
        }
        return ret
      },
    },
  },
)

listingSchema.index({ geoLocation: '2dsphere' })

listingSchema.pre('validate', function syncGeoLocation() {
  if (this.coordinates?.lat != null && this.coordinates?.lng != null) {
    this.geoLocation = {
      type: 'Point',
      coordinates: [this.coordinates.lng, this.coordinates.lat],
    }
  }
})

export const Listing = mongoose.model('Listing', listingSchema)
