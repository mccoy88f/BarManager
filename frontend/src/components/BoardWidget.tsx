import { useState } from 'react';
import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { ImageLightbox } from './ImageLightbox';

interface BoardMessageRow {
  id: string;
  text: string;
  photoUrl?: string;
  pinned: boolean;
  createdAt: string;
}

/** Messaggi pinnati della bacheca, subito visibili in home sotto "Oggi". */
export function BoardWidget() {
  const navigate = useNavigate();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const pinnedQuery = useQuery({
    queryKey: ['board-pinned'],
    queryFn: async () => (await api.get<BoardMessageRow[]>('/board/messages/pinned')).data,
  });

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: pinnedQuery.data?.length ? 2 : 0,
            cursor: 'pointer',
          }}
          onClick={() => navigate('/board')}
        >
          <Typography variant="h6">Bacheca</Typography>
          <Typography variant="body2" color="primary">
            Vedi tutti i messaggi
          </Typography>
        </Box>

        <Stack spacing={1.5}>
          {pinnedQuery.data?.map((msg) => (
            <Box
              key={msg.id}
              sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}
            >
              {msg.photoUrl && (
                <Box
                  component="img"
                  src={msg.photoUrl}
                  alt=""
                  onClick={() => setLightbox(msg.photoUrl!)}
                  sx={{
                    width: 64,
                    height: 64,
                    objectFit: 'cover',
                    borderRadius: 1,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
              )}
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <PushPinIcon fontSize="small" color="primary" />
                  <Typography variant="caption" color="text.secondary">
                    {new Date(msg.createdAt).toLocaleDateString('it-IT')}
                  </Typography>
                </Stack>
                <Typography variant="body2">{msg.text}</Typography>
              </Box>
            </Box>
          ))}
          {pinnedQuery.data?.length === 0 && (
            <Chip
              size="small"
              variant="outlined"
              label="Nessun messaggio in evidenza"
              onClick={() => navigate('/board')}
            />
          )}
        </Stack>
      </CardContent>

      <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </Card>
  );
}
