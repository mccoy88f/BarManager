import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton, Stack, Box, CircularProgress, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import CloseIcon from '@mui/icons-material/Close';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfViewerDialogProps {
  file: { url: string; filename: string } | null;
  onClose: () => void;
}

/**
 * react-zoom-pan-pinch ingrandisce solo via CSS (transform: scale), senza
 * mai richiedere a pdf.js un nuovo rendering: ingrandire una pagina
 * disegnata a risoluzione "1×" restituisce pixel sempre più grossi, non
 * più dettaglio. Per uno zoom nitido si disegna il canvas più grande del
 * necessario fin da subito (RENDER_SCALE×) e si forza la sua dimensione
 * visualizzata (CSS) alla larghezza del contenitore: il browser lo
 * ridisegna scalato verso il basso, che resta nitido, e lo zoom (fino a
 * RENDER_SCALE, coerente col maxScale del TransformWrapper) non fa che
 * riportarlo verso la sua risoluzione nativa, mai oltre.
 */
const RENDER_SCALE = 3;

/**
 * Anteprima PDF dentro l'app, resa con PDF.js (react-pdf) su un canvas
 * invece che con un <iframe>: un iframe punta al visualizzatore PDF
 * nativo del browser, che su alcuni browser/webview (comune su mobile,
 * incluse le webview di app native) non è disponibile e lascia
 * un'anteprima grigia e vuota, anche se il download dello stesso file
 * funziona sempre (è solo un salvataggio di byte, non un rendering).
 * Il rendering via PDF.js non dipende da un plugin nativo: funziona
 * allo stesso modo ovunque. Lo zoom/pan (pulsanti + pinch-to-zoom su
 * mobile) è di react-zoom-pan-pinch, applicato sopra al canvas.
 */
export function PdfViewerDialog({ file, onClose }: PdfViewerDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setNumPages(null);
    setLoadError(false);
  }, [file?.url]);

  useEffect(() => {
    // Il contenitore esiste nel DOM solo quando il dialog è aperto (MUI non
    // lo monta finché open=false): l'effetto deve ripartire ad ogni apertura,
    // non solo alla creazione del componente, altrimenti containerRef.current
    // resta null per sempre e le pagine non vengono mai disegnate.
    if (!file) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [file]);

  return (
    <Dialog open={!!file} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
      <TransformWrapper minScale={0.5} maxScale={RENDER_SCALE} centerZoomedOut doubleClick={{ mode: 'toggle' }}>
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
              {file?.filename}
              <Stack direction="row" spacing={0.5}>
                <IconButton onClick={() => zoomOut()} title="Riduci">
                  <ZoomOutIcon />
                </IconButton>
                <IconButton onClick={() => zoomIn()} title="Aumenta">
                  <ZoomInIcon />
                </IconButton>
                <IconButton onClick={() => resetTransform()} title="Adatta alla finestra">
                  <RestartAltIcon />
                </IconButton>
                {file && (
                  <IconButton component="a" href={file.url} download={file.filename} title="Scarica">
                    <DownloadIcon />
                  </IconButton>
                )}
                <IconButton onClick={onClose} title="Chiudi">
                  <CloseIcon />
                </IconButton>
              </Stack>
            </DialogTitle>
            <DialogContent ref={containerRef} sx={{ p: 0, overflow: 'hidden', bgcolor: 'grey.200' }}>
              {file && !loadError && (
                <TransformComponent
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: '100%', display: 'flex', justifyContent: 'center' }}
                >
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 2 }}>
                    <Document
                      file={file.url}
                      onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                      onLoadError={() => setLoadError(true)}
                      loading={
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                          <CircularProgress />
                        </Box>
                      }
                    >
                      {numPages &&
                        Array.from({ length: numPages }, (_, i) =>
                          containerWidth > 0 ? (
                            <Box
                              key={i}
                              sx={{
                                width: containerWidth,
                                overflow: 'hidden',
                                '& .react-pdf__Page__canvas': {
                                  width: '100% !important',
                                  height: 'auto !important',
                                },
                              }}
                            >
                              <Page
                                pageNumber={i + 1}
                                width={containerWidth * RENDER_SCALE}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                              />
                            </Box>
                          ) : (
                            <Page
                              key={i}
                              pageNumber={i + 1}
                              renderTextLayer={false}
                              renderAnnotationLayer={false}
                            />
                          ),
                        )}
                    </Document>
                  </Box>
                </TransformComponent>
              )}
              {loadError && (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary">
                    Impossibile visualizzare l'anteprima di questo PDF.
                  </Typography>
                </Box>
              )}
            </DialogContent>
          </>
        )}
      </TransformWrapper>
    </Dialog>
  );
}
