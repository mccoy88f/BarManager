import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArticleIcon from '@mui/icons-material/Article';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/authStore';

interface KbArticleListRow {
  id: string;
  title: string;
  updatedAt: string;
}

/** Elenco degli articoli della knowledge base interna, aperti al click. */
export function KbHome() {
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';

  const articlesQuery = useQuery({
    queryKey: ['kb-articles'],
    queryFn: async () => (await api.get<KbArticleListRow[]>('/kb/articles')).data,
  });

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">KBpedia</Typography>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/kb/new')}>
            Aggiungi
          </Button>
        )}
      </Box>

      <Stack spacing={1}>
        {articlesQuery.data?.map((article) => (
          <Card key={article.id} variant="outlined">
            <CardContent
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer' }}
              onClick={() => navigate(`/kb/${article.id}`)}
            >
              <ArticleIcon color="primary" />
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {article.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Aggiornato il {new Date(article.updatedAt).toLocaleDateString('it-IT')}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        ))}
        {articlesQuery.data?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nessun articolo pubblicato.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
