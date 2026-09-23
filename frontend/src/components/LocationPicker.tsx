import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Box, Typography } from '@mui/material';
import L from 'leaflet';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';

const markerIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Centro provvisorio quando non è ancora stata impostata una posizione:
// Roma, giusto per non aprire la mappa sull'oceano.
const DEFAULT_CENTER: [number, number] = [41.9028, 12.4964];

function ClickToMove({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onChange(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

/**
 * Ricentra la mappa (mantenendo lo zoom corrente) quando la posizione
 * cambia da fuori il componente (es. bottone "posizione attuale"), ma
 * non quando l'utente ha appena cliccato/trascinato sulla mappa stessa:
 * in quel caso il punto scelto è già visibile, ricentrare sposterebbe la
 * vista sotto al dito/cursore in modo spiazzante.
 */
function RecenterOnChange({
  lat,
  lng,
  skipNextRef,
}: {
  lat: number;
  lng: number;
  skipNextRef: MutableRefObject<boolean>;
}) {
  const map = useMap();
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map, skipNextRef]);
  return null;
}

interface LocationPickerProps {
  lat: number | null;
  lng: number | null;
  radiusMeters?: number;
  onChange: (lat: number, lng: number) => void;
  height?: number;
}

/**
 * Mappa OpenStreetMap (Leaflet, gratuita anche per uso commerciale) con un
 * puntatore trascinabile: clic sulla mappa o drag del marker per impostare
 * manualmente la posizione, letta subito sotto le coordinate.
 */
export function LocationPicker({ lat, lng, radiusMeters, onChange, height = 280 }: LocationPickerProps) {
  const hasPosition = lat !== null && lng !== null;
  const markerRef = useRef<L.Marker>(null);
  const skipNextRecenterRef = useRef(false);

  const initialCenter = useMemo<[number, number]>(
    () => (hasPosition ? [lat!, lng!] : DEFAULT_CENTER),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleMapChange = (newLat: number, newLng: number) => {
    skipNextRecenterRef.current = true;
    onChange(newLat, newLng);
  };

  return (
    <Box>
      <Box
        sx={{
          height,
          borderRadius: 1,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <MapContainer
          center={initialCenter}
          zoom={hasPosition ? 17 : 5}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <ClickToMove onChange={handleMapChange} />
          {hasPosition && (
            <>
              <RecenterOnChange lat={lat!} lng={lng!} skipNextRef={skipNextRecenterRef} />
              <Marker
                position={[lat!, lng!]}
                draggable
                icon={markerIcon}
                ref={markerRef}
                eventHandlers={{
                  dragend: () => {
                    const pos = markerRef.current?.getLatLng();
                    if (pos) handleMapChange(pos.lat, pos.lng);
                  },
                }}
              />
              {!!radiusMeters && radiusMeters > 0 && (
                <Circle
                  center={[lat!, lng!]}
                  radius={radiusMeters}
                  pathOptions={{ color: '#1976d2', fillOpacity: 0.1 }}
                />
              )}
            </>
          )}
        </MapContainer>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Clicca sulla mappa o trascina il puntatore per impostare manualmente la posizione.
      </Typography>
    </Box>
  );
}
