import { Box, Button, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface KbArticle {
  id: string;
  title: string;
  contentHtml: string;
  updatedAt: string;
}

/** Lettura di un articolo KBpedia: il contenuto è già sanificato lato server al salvataggio. */
export function KbArticleView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const [confirmDelete, setConfirmDelete] = useState(false);

  const articleQuery = useQuery({
    queryKey: ['kb-article', id],
    queryFn: async () => (await api.get<KbArticle>(`/kb/articles/${id}`)).data,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => (await api.delete(`/kb/articles/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
      navigate('/kb');
    },
  });

  if (!articleQuery.data) return null;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/kb')}>
          KBpedia
        </Button>
        {isAdmin && (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<EditIcon />}
              onClick={() => navigate(`/kb/${id}/edit`)}
            >
              Modifica
            </Button>
            <Button
              size="small"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setConfirmDelete(true)}
            >
              Elimina
            </Button>
          </Stack>
        )}
      </Stack>

      <Typography variant="h5" fontWeight={700}>
        {articleQuery.data.title}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Aggiornato il {new Date(articleQuery.data.updatedAt).toLocaleDateString('it-IT')}
      </Typography>

      <Box
        sx={{ '& img, & video': { maxWidth: '100%' } }}
        dangerouslySetInnerHTML={{ __html: articleQuery.data.contentHtml }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminare l'articolo?"
        message={`"${articleQuery.data.title}" verrà eliminato definitivamente.`}
        loading={deleteMutation.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Box>
  );
}
