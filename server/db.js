import mongoose from 'mongoose'

export async function connectDatabase(mongoUri) {
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Add it to your environment before starting the server.')
  }

  mongoose.set('strictQuery', true)

  await mongoose.connect(mongoUri, {
    dbName: 'urban_waste_exchange',
  })
}
