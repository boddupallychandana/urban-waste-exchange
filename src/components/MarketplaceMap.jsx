import { memo } from 'react'
import L from 'leaflet'
import { Circle, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

delete L.Icon.Default.prototype._getIconUrl

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const sellerIcon = new L.DivIcon({ className: 'map-pin seller', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] })
const claimedIcon = new L.DivIcon({ className: 'map-pin claimed', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] })
const completedIcon = new L.DivIcon({ className: 'map-pin completed', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] })
const recyclerIcon = new L.DivIcon({ className: 'map-pin recycler', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] })

function getIcon(status) {
  if (status === 'claimed') return claimedIcon
  if (status === 'completed') return completedIcon
  return sellerIcon
}

function MarketplaceMap({ listings, recyclerCoordinates, selectedRadiusKm }) {
  const fallbackCenter = recyclerCoordinates
    ? [recyclerCoordinates.lat, recyclerCoordinates.lng]
    : listings[0]?.coordinates
      ? [listings[0].coordinates.lat, listings[0].coordinates.lng]
      : [12.9716, 77.5946]

  return (
    <div className="map-shell">
      <MapContainer center={fallbackCenter} zoom={12} scrollWheelZoom className="market-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {recyclerCoordinates ? (
          <>
            <Marker position={[recyclerCoordinates.lat, recyclerCoordinates.lng]} icon={recyclerIcon}>
              <Popup>Your recycler position</Popup>
            </Marker>
            <Circle center={[recyclerCoordinates.lat, recyclerCoordinates.lng]} radius={selectedRadiusKm * 1000} pathOptions={{ color: '#0f4e3a', fillColor: '#0f4e3a', fillOpacity: 0.08 }} />
          </>
        ) : null}

        {listings.filter((listing) => listing.coordinates?.lat != null && listing.coordinates?.lng != null).map((listing) => (
          <Marker key={listing.id} position={[listing.coordinates.lat, listing.coordinates.lng]} icon={getIcon(listing.status)}>
            <Popup>
              <strong>{listing.title}</strong>
              <br />
              {listing.addressLabel || `${listing.locality}, ${listing.city}`}
              <br />
              {listing.material} - {listing.weightKg} kg
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

export default memo(MarketplaceMap)
