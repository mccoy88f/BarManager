import { useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { RichTextEditor } from '../../components/RichTextEditor';

interface KbArticle {
  id: string;
  title: string;
  contentHtml: string;
}

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data;
  const message = data?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (message) return message;
  return 'Errore durante il salvataggio.';
}

/** Crea (senza :id) o modifica (con :id) un articolo KBpedia. */
export function KbEditor() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const articleQuery = useQuery({
    queryKey: ['kb-article', id],
    queryFn: async () => (await api.get<KbArticle>(`/kb/articles/${id}`)).data,
    enabled: isEditing,
  });

  useEffect(() => {
    if (articleQuery.data) {
      setTitle(articleQuery.data.title);
      setContent(articleQuery.data.contentHtml);
    }
  }, [articleQuery.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['kb-article', id] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEditing) {
        return (await api.patch(`/kb/articles/${id}`, { title: title.trim(), contentHtml: content }))
          .data;
      }
      return (await api.post('/kb/articles', { title: title.trim(), contentHtml: content })).data;
    },
    onSuccess: (article: { id: string }) => {
      invalidate();
      setError(null);
      navigate(`/kb/${article.id}`);
    },
    onError: (err) => setError(extractErrorMessage(err)),
  });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        sx={{ justifySelf: 'flex-start' }}
        onClick={() => navigate(isEditing ? `/kb/${id}` : '/kb')}
      >
        Annulla
      </Button>

      <Typography variant="h6">{isEditing ? 'Modifica articolo' : 'Nuovo articolo'}</Typography>

      <TextField label="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />

      <RichTextEditor value={content} onChange={setContent} />

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" justifyContent="flex-end">
        <Button
          variant="contained"
          disabled={!title.trim() || !content.trim() || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          Salva
        </Button>
      </Stack>
    </Box>
  );
}
