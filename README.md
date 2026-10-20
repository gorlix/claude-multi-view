# multi-view

Una mod di Claude Code (plugin con hooks module TypeScript) che dà una vista comoda per lavorare con più chat e più agenti insieme. Versione 0.4.0.

Pensata per il terminale, in particolare dentro tmux: una banda sopra il prompt con i dati che servono a colpo d'occhio, un pannello "Agenti" con l'albero degli agenti, le sessioni salvate del workspace e i task PACA, e dei toast quando succede qualcosa mentre guardi altrove. Dentro tmux, in più, la finestra prende il titolo della chat.

## Come appare

I disegni sono ricavati dal codice di rendering (`hooks/register.tsx`, `hooks/ui.ts`), con dati inventati. I colori non si vedono in ASCII: sono annotati sotto ogni disegno e riassunti nella legenda in fondo.

### Banda sopra il prompt

Nel terminale è una sola riga; qui è spezzata per stare in pagina. I segmenti, da sinistra a destra, compaiono solo quando hanno qualcosa da dire:

```
5h ▰▰▰▰▱▱▱▱ 42% 2h10m │ sett ▰▰▱▱▱▱▱▱ 18% 4g3h │ ctx ▰▰▱▱▱▱▱▱ 34% │
chat: homelab │ ⎇ fix-banda feat/git ●2 +1 ?3 ↑1 │
 HOME-12  In Progress: Scheda cluster nel pannello │ ⏱ 1m23s │
● 2 ◐ 1 / 3 │ ✉ 2 │ ⋯
```

1. `5h ...` e `sett ...`: i limiti di utilizzo, barra a 8 celle, percentuale, tempo al reset (premilo per vedere l'orario del reset, es. `18:40` o `lun 18:40`; ripremi per tornare al conto alla rovescia). Colori: barra e percentuale verdi, gialle da 80%, rosse da 90%; nome, celle vuote e tempo al reset attenuati.
2. `ctx ...`: contesto della chat. Verde, giallo da 60%, rosso da 80%.
3. `chat: homelab`: ultima cartella del percorso di lavoro, attenuata.
4. `⎇ fix-banda feat/git ●2 +1 ?3 ↑1`: lo stato git della cartella di lavoro. `⎇ fix-banda` (attenuato) compare solo se la cartella è un worktree collegato e dice il nome della sua cartella; poi il ramo in ciano (un HEAD staccato è `@` e i primi 7 caratteri del commit); poi, solo se diversi da zero, in giallo `●N` file modificati non in stage, `+N` in stage, `?N` non tracciati, e attenuati `↑N` commit avanti e `↓N` indietro rispetto all'upstream. Fuori da un repo git il segmento manca.
5. ` HOME-12 ` e `In Progress: ...`: il task PACA attivo. Il riferimento è un badge in inverse blu, stato e titolo (tagliato a 40 caratteri) in blu.
6. `⏱ 1m23s`: durata del turno. Mentre il turno gira è in ciano e si aggiorna ogni 5 secondi; a turno finito resta l'ultima durata attenuata (`⏱ 45s`, `⏱ 1h02m`). Prima del primo turno manca.
7. `● 2 ◐ 1 / 3`: agenti attivi (verde), idle (giallo), totale (attenuato).
8. `✉ 2`: messaggi in coda nell'inbox, in giallo.
9. `⋯`: pulsante, sempre visibile, che apre il menù della banda (vedi sotto).

Quando guardi la trascrizione di un agente la coda della banda diventa:

```
... │ ● 2 ◐ 1 / 3 │ vista: scrivi-test │ Torna │ ⋯
```

Sotto i 120 caratteri di larghezza la banda toglie le barre e tiene solo i numeri (`5h 31% 14:20`); un segmento che non ci sta va a capo intero, senza spezzarsi.

`vista: ...` è in ciano, `Torna` è un pulsante e riporta alla conversazione principale. Se la sessione non ha ancora ricevuto una risposta mancano limiti e `ctx`; senza agenti, task attivo e messaggi mancano i rispettivi segmenti. I segmenti si possono anche spegnere dal menù `⋯`: quelli rimasti sono separati da un solo `│`, mai uno in testa o doppio.

Premendo `⋯` sotto la banda compare una seconda riga con le impostazioni della banda, ognuna un pulsante a due stati (`☑` acceso, `☐` spento):

```
5h ▰▰▰▰▱▱▱▱ 42% 2h10m │ ... │ ⋯
☑ limiti │ ☑ ctx │ ☑ chat │ ☑ git │ ☑ turno │ ☑ task PACA │ ☑ agenti │ ☑ messaggi │ chiudi
```

`chiudi` (o di nuovo `⋯`) richiude la riga. `task PACA` c'è solo se il workspace è collegato a un progetto PACA, come nel `⚙` del pannello. Le scelte si salvano e valgono per tutte le sessioni; `/multiview` apre lo stesso menù. Ogni interruttore agisce solo sulla banda: per il pannello c'è il `⚙` nel pannello stesso (vedi sotto).

### Pannello "Agenti"

In cima al pannello c'è la barra delle schede, una riga di pulsanti (va a capo se il pannello è stretto):

```
▸ ☰ Tutto  ▰ Limiti  ● Agenti 5  ↺ Sessioni  ⑂ Verticali 1  ◆ PACA 3  ✉ Messaggi 2  ⚙ Impostazioni
```

Ogni scheda ha icona e nome: `☰ Tutto`, `▰ Limiti`, `● Agenti N`, `↺ Sessioni`, `⑂ Verticali N`, `◆ PACA N`, `✉ Messaggi N`, `⚙ Impostazioni`. Dal `⚙` si sceglie se mostrarle con icona + nome (predefinito), solo icona (la barra più corta) o solo nome. La scheda scelta ha `▸` davanti e mostra solo la sua sezione; `☰` le mostra tutte. In fondo alla barra c'è `⚙`, che apre le impostazioni del pannello (vedi sotto). `▰` c'è solo se ci sono limiti da mostrare, `● N` conta le righe di agenti (senza numero se sono zero), `⑂ N` le chat verticali attive (la scheda c'è solo se questa chat ne ha), `◆ N` i task aperti mostrati (solo se il workspace è agganciato), `✉ N` i messaggi (`✉` senza numero se l'inbox è vuota: la scheda resta). Se la scheda scelta sparisce (per esempio spegni la sua sezione dal `⚙`) il pannello torna a `☰`. La scheda scelta si salva insieme alle impostazioni.

Sezioni con bordo arrotondato e titolo in grassetto, nell'ordine in cui compaiono; ognuna c'è solo se ha contenuto (Agenti e Sessioni ci sono sempre, Verticali solo se questa chat ne ha, PACA solo se il workspace è agganciato). Qui sono tutte aperte, in un pannello largo 56 colonne:

```
╭──────────────────────────────────────────────────────╮
│ Limiti                                               │
│ 5h   ▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱ 42%                    │
│      reset tra 2h10m                                 │
│ sett ▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱ 18%                    │
│      reset tra 4g3h                                  │
╰──────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────╮
│ Agenti                                               │
│ ▸ Conversazione principale                           │
│ ● rifattorizza-banda   running · general-purpose     │
│ ├─ ● scrivi-test       running · general-purpose     │
│ ├─ ◐ controlla-tipi    idle · Explore                │
│ └─ ✓ revisione         completed · general-purpose   │
│ ✗ migra-store          failed · general-purpose      │
╰──────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────╮
│ Sessioni                                             │
│ ▾ Sessioni del workspace                             │
│   ● Mod UI multi-agent (questa)                      │
│   ●  HOME-16  Pannello verticali   5m fa             │
│     └ vai │ chiudi                                   │
│   ○  HOME-12  Scheda cluster   3h fa                 │
│   ○ Appunti sul backup notturno   2g fa              │
╰──────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────╮
│ Verticali                                            │
│ ● fix-banda Sistema la banda del pannello ctx 42% vai│
│ ◐ docs README vai                                    │
│ ✓ vecchio Finito ctx 7% vai                          │
╰──────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────╮
│ PACA                                                 │
│ ▾ Home (3 aperti · 12 backlog)                       │
│  HOME-12  In Progress                                │
│   Scheda cluster nel pannello                        │
│   └ Lavora qui │ Nuova chat │ Copia ref              │
│  HOME-16  Todo                                       │
│   Pannello verticali                                 │
│   └ Lavora qui │ Nuova chat │ Copia ref              │
╰──────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────╮
│ ✉ Messaggi (2)                                       │
│ ▸ 14:32 · verticale-acme · Riepilogo pronto          │
│ ▸ 13:05 · altra sessione · Ho finito il refactor d…  │
│ Svuota inbox                                         │
╰──────────────────────────────────────────────────────╯
```

Nel disegno gli stati degli agenti sono incolonnati per leggibilità; nel pannello reale seguono il nome dopo uno spazio.

- **Limiti** (bordo grigio): la barra si allarga con il pannello, da 8 a 24 celle (qui 24); sotto, `reset tra ...`: è un pulsante che alterna `reset tra 2h10m` e l'orario (`reset alle 18:40`, `reset lun 18:40` se non è oggi). La scelta vale insieme per banda e pannello.
- **Agenti** (bordo verde): `Conversazione principale` è un pulsante, con `▸` quando è la vista corrente. Ogni agente ha il glifo di stato, un pulsante col nome (`▸` davanti se è quello in vista) e a destra `stato · tipo`. Senza agenti compare `Nessun agente in questa sessione.`
- **Sessioni** (bordo ciano): il pulsante `Sessioni del workspace` apre e chiude l'elenco (massimo 12, dalla più recente). Una sessione già aperta (in esecuzione, in qualunque finestra tmux, anche con un nome diverso; in più, come ripiego, una finestra il cui nome finisce con `·<id8>`) ha un `●` verde al posto di `○` e, sotto, due pulsantini: `vai` seleziona la finestra, `chiudi` la chiude con `tmux kill-window` ma chiede conferma: la prima pressione diventa `conferma?`, la seconda chiude; passati 5 secondi, o premendo `vai` o riprendendo una sessione, la conferma si annulla. La sessione corrente non ha mai `chiudi`. Se la sessione gira fuori da tmux c'è il `●` ma niente `chiudi`, e `vai` risponde con un toast `Aperta fuori da tmux`. La sessione corrente è attenuata e non cliccabile. Il badge `HOME-16` è in inverse, blu se è il task attivo di questa chat, altrimenti col colore del terminale. L'età (`5m fa`) è attenuata.
- **Verticali** (bordo magenta): le chat verticali aperte da questa chat, lette in sola lettura dallo store di `chat-verticali`. Per riga: glifo di stato (`●` verde attiva, `◐` gialla in pausa, `✓` attenuato finita), slug, titolo tagliato, `ctx N%` attenuato se noto e il pulsante `vai`, che seleziona la finestra tmux della chat (trovata dal registro delle sessioni in esecuzione tramite l'id; se manca, quella il cui nome è lo slug o finisce con `·<id8>`). Se non c'è, un toast lo dice (`Aperta fuori da tmux` se gira fuori da tmux).
- **PACA** (bordo blu): il pulsante riassume `<progetto> (N aperti · M backlog)`. Aperto, mostra fino a 10 task: badge del riferimento in inverse e stato dello stesso colore (blu, magenta o giallo secondo la categoria), titolo sotto, poi i tre pulsanti separati da `│` attenuato.
- **Messaggi** (bordo giallo, grigio se vuota): c'è sempre, anche senza messaggi, con la riga `Nessun messaggio...` che spiega cosa ci arriva. Mostra gli ultimi 5, il più recente in alto, come una riga sola `▸ 14:32 · chat · titolo`: ora d'arrivo, chat che l'ha mandato (tagliata a 20 caratteri) e titolo, cioè la prima riga del messaggio fino al primo punto, senza segni markdown; la riga è tagliata alla larghezza del pannello. Premendo una riga il messaggio si apre per intero, con `Copia` e `Nel prompt` (lo mette nel prompt per rispondere o riprenderlo); ripremendo si richiude. `Svuota inbox` li cancella.

### Finestre tmux col titolo della chat

Dentro tmux la mod rinomina la finestra con il titolo della chat, così la barra di stato dice a colpo d'occhio che cosa c'è in ogni finestra:

```
 0:Mod UI multi-agent  1:home-16-pannello  2:MCP Proxmox e cluster·1e8d3308
```

La finestra `0` è una chat rinominata dalla mod, la `1` ha il nome scelto a mano (per esempio lo slug di una chat verticale: la mod non la tocca), la `2` è una sessione ripresa dall'elenco, con il suffisso `·` e i primi 8 caratteri dell'id.

### Legenda

| Glifo | Dove | Significato |
|---|---|---|
| `●` verde | agenti | `running`: l'agente sta lavorando |
| `●` ciano | agenti | `pending` o `waiting` |
| `◐` giallo | agenti | `idle`: fermo, in attesa |
| `✓` attenuato | agenti | `completed` |
| `✗` rosso | agenti | `failed` |
| `■` attenuato | agenti | `killed` |
| `·` attenuato | agenti | stato sconosciuto |
| `●` / `○` | sessioni | `●` attenuato è la chat corrente (non cliccabile), `●` verde una sessione con finestra tmux aperta, `○` una sessione riprendibile |
| `●` `◐` `✓` | verticali | attiva (verde), in pausa (giallo), finita (attenuato) |
| `⎇` | banda | worktree git collegato |
| `⏱` | banda | durata del turno |
| `▰` / `▱` | barre | cella piena / vuota; con un uso maggiore di 0 c'è sempre almeno una cella piena |
| `▸` / `▾` | pannello | sezione chiusa / aperta; davanti a una riga indica la vista corrente |
| `✉` | banda, pannello | messaggi in arrivo da altre sessioni |
| `├─` `└─` `│` | agenti | connettori dell'albero |

Le barre di limiti e contesto hanno soglie diverse:

| Barra | Verde | Giallo | Rosso |
|---|---|---|---|
| Limiti 5h e `sett` | sotto 80% | da 80% | da 90% |
| Contesto `ctx` | sotto 60% | da 60% | da 80% |

Altri colori:

- Etichetta del task PACA (colori invertiti): blu per `inprogress`, magenta per `refinement`, giallo per `todo`. Nella banda è sempre blu; nell'elenco sessioni è blu solo se è il task attivo, altrimenti neutra.
- Bordo delle sezioni del pannello: grigio Limiti, verde Agenti, ciano Sessioni, magenta Verticali, blu PACA, giallo Messaggi.
- Riga di un agente `failed`: stato in rosso; `idle`, `completed` e `killed` hanno lo stato attenuato.
- `vista: <nome>` in ciano.
- Git: ramo ciano, conteggi di modifiche gialli, `↑`/`↓` e `⎇` attenuati. Timer del turno: ciano mentre gira, attenuato dopo.

## Funzioni

### Banda sopra il prompt

Una riga sopra il prompt, con i segmenti separati da `│` attenuato, da sinistra a destra:

- **Limiti di utilizzo**: 5h e settimanale (`sett`) come mini barra a 8 celle (`5h ▰▰▰▰▱▱▱▱ 42% 2h10m`), con percentuale usata e tempo al reset. Barra e percentuale sono verdi, gialle da 80% e rosse da 90%. Il tempo al reset si aggiorna una volta al minuto; premendolo mostra l'orario locale del reset e viceversa.
- **Contesto**: `ctx ▰▰▱▱▱▱▱▱ 34%`, la percentuale di finestra di contesto usata dalla chat. Verde sotto il 60%, giallo da 60%, rosso da 80% (60% è la soglia oltre cui conviene passare a una nuova chat). Non compare finché la sessione non ha ricevuto una risposta.
- **Nome della chat**: l'ultima cartella del percorso di lavoro (`chat: homelab`).
- **Git**: ramo e conteggi della cartella di lavoro (vedi sopra), con `⎇ <cartella>` davanti se è un worktree collegato (`git rev-parse --git-dir` diverso da `--git-common-dir`). Letto con `git status --porcelain=v2 --branch` all'avvio, a ogni fine turno e ogni 30 secondi.
- **Turno**: `⏱ 1m23s`. La mod ascolta `turn.start` (inizio, solo del ciclo principale: i turni degli agenti hanno `agentId` e si ignorano) e `turn.complete` (fine, con `durationMs`). Mentre gira si aggiorna ogni 5 secondi; non c'è nessun timer acceso quando non gira.
- **Task PACA attivo**: il riferimento come etichetta a colori invertiti, poi stato e titolo in blu (` HOME-12 ` `In Progress: titolo`). Vedi la sezione PACA.
- **Conteggio agenti**: `● 2 ◐ 1 / 3`, cioè attivi in verde, idle in giallo, totale attenuato; solo se c'è almeno un agente.
- **Messaggi in arrivo**: `✉ N` in giallo, se l'inbox non è vuota.
- Pulsante **Sessioni**: apre il pannello con l'elenco delle sessioni salvate.
- Pulsante **⋯**: apre il menù della banda sotto la banda.
- **Vista agente**: quando stai guardando la trascrizione di un agente compare `vista: <nome>` e il pulsante **Torna**, che riporta alla conversazione principale.

La banda non compare se Claude Code sta mostrando il questionario di feedback.

### Impostazioni: banda e pannello

Le impostazioni sono divise: quelle della banda stanno nella banda, quelle del pannello nel pannello, e ognuna controlla solo la propria superficie (per esempio la banda può mostrare solo i limiti mentre il pannello mostra tutto il resto).

`⋯` in fondo alla banda (o `/multiview`) apre una seconda riga con gli interruttori e `chiudi`:

- **limiti**: mostra o nasconde i segmenti 5h e `sett`.
- **ctx**: il segmento `ctx`.
- **chat**: il testo `chat: <nome>`.
- **git**: il segmento git.
- **turno**: il timer del turno.
- **task PACA**: l'etichetta del task attivo.
- **agenti**: il conteggio `● 2 ◐ 1 / 3`.
- **messaggi**: `✉ N`.
- **sessioni**: il pulsante `Sessioni`.

Il pulsante `⋯` è sempre visibile; `vista: ...` e `Torna` compaiono sempre quando guardi un agente.

`⚙` in fondo alla barra delle schede del pannello apre la sezione `Impostazioni` (bordo grigio), subito sotto la barra, con un interruttore per riga e `chiudi`:

```
╭──────────────────────────╮
│ Impostazioni             │
│ ☑ limiti                 │
│ ☑ agenti                 │
│ ☑ sessioni               │
│ ☑ verticali              │
│ ☑ PACA                   │
│ ☑ messaggi               │
│ ☑ notifiche desktop      │
│ ☑ pannello all'avvio     │
│ schede: ◉ icona + nome   │
│ chiudi                   │
╰──────────────────────────╯
```

- **limiti**, **agenti**, **sessioni**, **verticali**, **PACA** (solo se il workspace è agganciato), **messaggi**: una sezione spenta sparisce da ogni scheda e sparisce anche la sua scheda; se era la scheda scelta il pannello torna a `☰`.
- **notifiche desktop**: spenta, niente `notify-send` (vedi Notifiche).
- **pannello all'avvio**: se spento, il pannello non si apre da solo all'avvio della sessione; i comandi lo aprono comunque.
- **schede**: `◉ icona + nome`, `○ solo icona`, `○ solo nome`, l'aspetto della barra delle schede (compreso `⚙`).

Tutte le scelte, più la scheda del pannello, stanno in un solo oggetto salvato nello store del plugin con la chiave globale `prefs` a ogni cambio e riletto all'avvio, prima di decidere se aprire il pannello (i nomi sono `bandLimits`, `bandCtx`, `bandChat`, `bandPaca`, `bandAgents`, `bandInbox`, `bandGit`, `bandTurn`, `paneLimits`, `paneAgents`, `panePaca`, `paneSessions`, `paneVerticals`, `paneInbox`, `notifyDesktop`, `openPaneAtStart`, `tab`; tutti accesi di default, e quelli mancanti in un salvataggio vecchio restano accesi). Se lo store non risponde, un toast avvisa che le impostazioni non sono salvate. Le righe di menù aperte o chiuse non si salvano.

### Pannello "Agenti"

Si apre da solo all'avvio della sessione (vedi i limiti; si può spegnere dal `⚙` del pannello) e con `/agenti`. Dall'alto, la barra delle schede (`☰`, `▰`, `● N`, `↺`, `⑂ N`, `◆ N`, `✉ N`, `⚙`) e poi:

Il pannello è fatto di sezioni con bordo arrotondato e titolo colorato, solo quelle che hanno contenuto:

1. **Limiti**: 5h e settimanale con una barra più larga della banda (si adatta alla larghezza del pannello, da 8 a 24 celle), la percentuale e sotto il tempo al reset (`reset tra 2h10m`), che premuto diventa l'orario (`reset alle 18:40`). Stessi colori della banda.
2. **Agenti**: il pulsante **Conversazione principale** (con `▸` quando è la vista corrente) e l'**albero degli agenti**, con i figli sotto al genitore tramite i connettori `├─` e `└─`. Ogni riga ha un glifo di stato e un pulsante: un click apre la trascrizione di quell'agente nella vista principale. A destra stato e tipo. Glifi: `●` verde per running e ciano per pending e waiting, `◐` giallo per idle, `✓` attenuato per completed, `✗` rosso per failed, `■` attenuato per killed.
3. **Sessioni**: la sezione richiudibile con le sessioni del workspace (vedi sotto).
4. **Verticali**: le chat verticali di questa chat (vedi sopra); la sezione c'è solo se ce n'è almeno una. Si rilegge insieme alle sessioni e ogni 60 secondi con `hooks/list_verticals.py`, che legge (mai scrive) il file `~/.claude/plugins/store/chat-verticali_gorlix-chat-verticali-*.json` e tiene le righe `v:<sessionId>` con `parentSessionId` uguale alla sessione corrente, in ordine attive, in pausa, finite.
5. **PACA**: visibile solo se il workspace è agganciato a un progetto.
6. **Messaggi**: l'inbox, sempre presente. Ci arrivano i messaggi di altre sessioni Claude Code (per esempio una chat verticale che chiude il lavoro e manda il riepilogo alla chat madre). Gli ultimi 5, il più recente in alto, una riga ciascuno con ora, chat e titolo; premendone uno si legge per intero e si può copiare o mettere nel prompt. **Svuota inbox** li cancella. I messaggi restano solo per la durata della sessione.

### Titolo della chat sulla finestra tmux

Novità della 0.4.0. Dentro tmux (serve `TMUX_PANE`) la finestra non resta "claude": prende il titolo della sessione, lo stesso che si vede nell'elenco delle sessioni (ultimo `/rename`, poi titolo automatico, poi primo prompt), letto con `hooks/session_title.py`, tagliato a 30 caratteri. Succede all'avvio della sessione e alla fine di ogni turno. Il suffisso `·<id8>` di una finestra aperta con la ripresa di una sessione viene mantenuto, perché serve a riconoscerla.

La mod rinomina solo finestre che può considerare sue: quelle che tmux rinomina ancora in automatico (`automatic-rename` non spento), quelle aperte dalla mod per una ripresa (nome con il suffisso), o quelle che ha già rinominato lei. Una finestra con un nome scelto a mano, per esempio lo slug di una chat verticale aperta con `-n`, resta com'è. Il comando `/titolo-finestra` forza la rinomina anche in questo caso. Fuori da tmux non fa niente e il comando risponde `Non sei in tmux.`

### Notifiche desktop

Oltre al toast, la mod lancia `notify-send -a "Claude multi-view" <titolo> <corpo>` (un unico helper `notify`) quando un agente finisce (`Agente completed` / nome), quando un limite supera l'80% o il 90% (`Limite 5h` / `al 85%`) e quando arriva un messaggio da un'altra sessione (`Messaggio da <mittente>` / titolo). Parte solo se non stai guardando: dentro tmux (`TMUX_PANE`) viene saltata quando la finestra di questo pannello è quella attiva di una sessione collegata (`tmux display-message -p -t $TMUX_PANE '#{window_active}#{session_attached}'` uguale a `11`); fuori da tmux parte sempre. Gli errori (niente `notify-send`, niente demone di notifiche) sono silenziosi. Si spegne dal `⚙` del pannello (`notifiche desktop`).

### Notifiche (toast)

- **Agente finito**: quando un agente passa da attivo (`pending`, `running`, `waiting`) a terminato (`completed`, `failed`, `killed`, `idle`), per esempio `Agente completed: nome`.
- **Messaggio da un'altra sessione**: `Messaggio da <mittente>`.
- **Soglie dei limiti**: `Limite 5h al 83%` la prima volta che si supera l'80% e di nuovo al 90%. Una soglia già notificata non si ripete finché la finestra non si azzera.
- **Cambi di stato PACA**: `HOME-12: Todo → In Progress` quando un task cambia stato tra due letture; per il task attivo anche `HOME-12 aggiornato su PACA` se cambia solo la data di aggiornamento.
- Errori di servizio: sessioni non leggibili, PACA non raggiungibile, comando non registrato.

### Sessioni salvate del workspace

Claude Code salva ogni sessione in `~/.claude/projects/<cwd>/<sessionId>.jsonl`, dove `<cwd>` è il percorso di lavoro con ogni carattere non alfanumerico sostituito da `-`. La mod lo ricostruisce e lo legge con `hooks/list_sessions.py`, lanciato con `python3 -I`.

Il titolo di ogni sessione viene da, in ordine: l'ultimo `custom-title` (quello di `/rename`), l'ultimo `ai-title`, l'ultimo `last-prompt`, altrimenti `(senza titolo)`; si usa solo la prima riga. L'elenco è ordinato dalla più recente e il pannello ne mostra 12, con quanto tempo fa sono state modificate (`5m fa`, `3h fa`, `2g fa`). Le sessioni in esecuzione si riconoscono da `hooks/running_sessions.py`, lanciato con `python3 -I`: legge solo i `~/.claude/sessions/<pid>.json` (mai i `.key`), tiene `sessionId`, `pid` e la posizione tmux (`finestra`/`pannello`), scarta tutto il resto (token compresi) e ignora i pid non più vivi. Le sessioni sono precedute da `○`, con l'età attenuata a fianco. Se il workspace è agganciato a un progetto PACA, davanti al titolo c'è il task su cui la sessione ha lavorato, come etichetta a colori invertiti (blu se è il task attivo di questa chat): `list_sessions.py` riceve `--prefix <PREFISSO>` e prende l'ultimo riferimento di quel prefisso trovato nei prompt dell'utente e negli input dei tool PACA, Bash e Skill (non nei risultati dei tool, che elencano molti task), così `ADR-010` o `UTF-8` non contano. La sessione corrente appare come `● titolo (questa)` e non è cliccabile.

Click su una sessione: dentro tmux apre una nuova finestra (`tmux new-window`, nella stessa cartella, col titolo tagliato a 24 caratteri come nome) che lancia `claude --resume <id>`. Il nome della finestra finisce con `·` e i primi 8 caratteri dell'id: prima di aprirne una nuova la mod rilegge le sessioni in esecuzione e, come ripiego, cerca quel suffisso con `tmux list-windows`: se la sessione è già aperta salta a quella finestra (`Già aperta: salto alla finestra`) invece di duplicarla, e se gira fuori da tmux lo dice (`Già aperta fuori da tmux`) senza avviare un secondo processo. Fuori da tmux copia il comando negli appunti e lo segnala con un toast. Una mod non può cambiare la sessione del processo in cui gira, per questo si passa da una nuova finestra.

### Integrazione PACA

La mod parla con l'MCP di PACA **direttamente**, chiamando i tool dall'interno senza far partire un turno del modello: niente token spesi per aggiornare l'elenco dei task.

**Aggancio del progetto.** All'avvio la mod cerca il progetto PACA del workspace così:

1. Se c'è un collegamento salvato con `/paca-link` (nello store, per cartella), cerca quel prefisso.
2. Altrimenti confronta il remote git `origin` con i repo GitHub collegati ai progetti PACA (`github_list_linked_repos`) e prende il primo progetto che lo contiene.

I server MCP si provano in ordine: quello indicato in `/paca-link`, poi `paca-<cartella del workspace>` (per esempio `paca-homelab`), poi `paca`. Il motivo di questa ricerca per server: un server MCP lanciato con `PACA_PROJECT_ID` vede solo quel progetto, quindi il server globale `paca` potrebbe non vedere affatto il progetto del repo, mentre quello dedicato sì.

**Polling.** I task si rileggono ogni 3 minuti e ogni volta che si apre la sezione PACA. Con più chat sullo stesso workspace fa polling (e toast) una sola: la sessione che tiene il lock `paca-poller:<projectId>` nello store del plugin, un file JSON condiviso tra le sessioni. Il lock si rinnova a ogni giro e un'altra sessione lo prende se è più vecchio di due intervalli; le altre rileggono i task solo quando si apre la sezione, senza toast. Si leggono fino a 5 pagine da 200 task.

**Cosa si mostra.** Solo le categorie di stato `inprogress`, `refinement` e `todo`, in quest'ordine; `backlog` e `done` no (vengono comunque ricordati per accorgersi di un task che esce dalla lista). Il pulsante della sezione dice `<progetto> (N aperti · M backlog)`, dove M conta i task in categoria `backlog` escludendo le epic (il tipo Epic si riconosce con `list_task_types`); aperta, mostra i primi 10 task: il riferimento come etichetta colorata per categoria (blu `inprogress`, magenta `refinement`, giallo `todo`) seguito dallo stato, e sotto il titolo. L'emoji che PACA mette davanti ai nomi degli stati viene tolta.

Per ogni task ci sono tre pulsanti:

- **Lavora qui**: riempie il prompt con `/paca-do <REF>`, senza inviarlo.
- **Nuova chat**: riempie il prompt con `/handoff <REF> <titolo>`. `/handoff` è un comando della mod `chat-verticali`, che serve installata per usarlo.
- **Copia ref**: copia il riferimento (per esempio `HOME-12`) negli appunti.

**Task attivo.** È il task che questa chat ha spostato in una categoria `inprogress` con `update_task` di un server PACA (`mcp__paca__update_task`, `mcp__paca-homelab__update_task`, ...). Quando la chiamata riesce, la mod rilegge i task e, se quello aggiornato è in `inprogress`, lo mette nella banda e lo salva per sessione nello store (chiave `paca-active:<sessionId>`), così sopravvive a una ripresa della stessa sessione.

## Comandi

| Comando | Cosa fa |
|---|---|
| `/multiview` | Apre il menù della banda sotto la banda (`⋯`); le impostazioni del pannello sono nel `⚙` del pannello. |
| `/agenti` | Rilegge gli agenti e apre il pannello. |
| `/sessioni` | Apre il pannello con la sezione sessioni espansa e ricaricata. |
| `/paca-tasks` | Apre il pannello con la sezione PACA espansa. Se il workspace non è agganciato, suggerisce `/paca-link`. |
| `/paca-link <PREFISSO> [server MCP]` | Collega il workspace al progetto con quel prefisso (maiuscolo automatico), opzionalmente su un server MCP preciso. Esempio: `/paca-link HOME paca-homelab`. |
| `/paca-link auto` | Cancella il collegamento e torna all'aggancio automatico via remote git. |
| `/paca-link off` | Disattiva PACA per questo workspace. |
| `/titolo-finestra` | Rinomina subito la finestra tmux col titolo della chat, anche se ha un nome scelto a mano. |
| `/inbox-clear` | Svuota i messaggi arrivati da altre sessioni. |

Il comando non si chiama `/paca` perché esiste già una skill `paca` con quel nome e la registrazione fallirebbe. Ogni comando è registrato a sé: se un nome è occupato, la mod avvisa con un toast e gli altri funzionano lo stesso.

## Installazione

Da GitHub, al prompt di una sessione Claude Code nel terminale:

```
/plugin install multi-view --marketplace gorlix/claude-multi-view
```

Poi `y` per aggiungere il marketplace e la scope (utente o progetto).

Da una copia locale, per svilupparla (il repo è anche un marketplace: `.claude-plugin/marketplace.json`, nome `gorlix-multi-view`, sorgente `./`):

```
claude plugin marketplace add ~/Documents/Git/claude-multi-view
claude plugin install multi-view@gorlix-multi-view
```

In questo caso il plugin è letto dalla cartella: dopo ogni modifica al codice, nella sessione aperta basta `/reload-plugins`.

Per una prova una tantum, senza installare:

```
claude --plugin-dir ~/Documents/Git/claude-multi-view
```

Requisiti:

- `python3` (legge le sessioni salvate).
- `tmux` (consigliato: serve per riprendere le sessioni in una nuova finestra; senza, il comando viene copiato).
- `git` (segmento git della banda e riconoscimento del progetto PACA dal remote `origin`).
- `notify-send` (opzionale: notifiche desktop; senza, restano i toast).
- Un server MCP PACA (opzionale: senza, le funzioni PACA restano spente e il resto funziona).

## Sviluppo

Struttura:

```
claude-multi-view/
├── .claude-plugin/
│   ├── plugin.json        # nome, versione, descrizione, percorso dei tipi
│   └── marketplace.json   # marketplace locale gorlix-multi-view
├── hooks/
│   ├── hooks.json         # dichiara il modulo: ./register.tsx
│   ├── register.tsx       # banda, pannello, comandi, toast, inbox
│   ├── ui.ts              # helper puri: barre, glifi, albero, soglie, durate, finestre tmux
│   ├── git.ts             # parser puri di git status e del worktree
│   ├── paca.ts            # MCP PACA: chiamate, parser, aggancio, polling
│   ├── session_title.py   # titolo di una sessione (nome finestra tmux)
│   ├── list_sessions.py   # sessioni salvate (titolo, task PACA) in JSON
│   ├── list_verticals.py  # chat verticali della sessione, dallo store di chat-verticali (sola lettura)
│   └── running_sessions.py # sessioni in esecuzione (id, pid, finestra/pannello tmux) da ~/.claude/sessions
├── types/index.d.ts       # tipi condivisi e stato dichiarato del plugin
├── tests/
│   ├── register.test.ts   # inbox, albero agenti, limiti, schede, menù, sessioni, git, turno, tmux, verticali, notifiche
│   ├── paca.test.ts       # parser PACA, backlog, lock, aggancio
│   ├── test_list_sessions.py  # ref PACA dalle trascrizioni
│   ├── test_list_verticals.py # filtro e ordine delle verticali
│   └── test_running_sessions.py # pid vivi, campi tenuti, niente token
└── tsconfig.json          # estende .claude-plugin/types/tsconfig.json
```

Comandi:

```
claude plugin validate ~/Documents/Git/claude-multi-view
claude plugin test ~/Documents/Git/claude-multi-view
python3 -I tests/test_list_sessions.py
python3 -I tests/test_list_verticals.py
python3 -I tests/test_running_sessions.py
```

Il type-check si fa con `tsc -p .` (senza emettere file): il `tsconfig.json` estende `.claude-plugin/types/tsconfig.json`, che l'engine scrive (con i tipi dell'API) solo quando carica la cartella in sviluppo, con `claude --plugin-dir .` o in hot reload. La cartella `types/` generata non è versionata.

Vincoli da conoscere, scoperti a proprie spese:

- **Gli atom di `$.state` vanno dichiarati con `atom(...)` nel file che li usa**, altrimenti il validatore protesta. Per questo `pacaProject`, `pacaTasks` e `pacaActive` sono dichiarati due volte, sia in `register.tsx` sia in `paca.ts`, con gli stessi `plugin` e `key`: sono lo stesso stato visto da due file.
- **Le funzioni che ricevono `$` vanno dichiarate a livello top del file**, non dentro altre funzioni.
- **Alza la versione in `plugin.json` a ogni rilascio**, altrimenti resta in uso la copia in cache della versione precedente.

## Limiti noti

- **Limiti di utilizzo.** Si leggono dall'ultima risposta dell'API, quindi mancano finché la sessione non ne ha ricevuta una. I valori sono quelli dell'ultima risposta, non una lettura in tempo reale.
- **Agenti.** Si rileggono ogni 2 secondi; quelli lanciati dai workflow non compaiono.
- **Apertura automatica del pannello.** All'avvio la mod chiede di aprire il pannello, ma è l'engine a decidere se c'è posto: secondo la documentazione delle mod un pannello aperto senza un'azione dell'utente si apre solo da 144 colonne in su. Sotto, si apre con `/agenti` o `/sessioni`.
- **Mittente dei messaggi.** Per i messaggi tra sessioni il mittente è quello che l'engine espone (nome del teammate o del plugin); molto spesso non c'è e compare "altra sessione".
- **Sessioni.** Il controllo "già aperta" usa il registro delle sessioni in esecuzione di Claude Code (`~/.claude/sessions`), quindi vede anche le `claude --resume` lanciate a mano e le finestre rinominate; dipende dal formato di quel registro, e se manca il campo `tmux` la sessione risulta aperta fuori da tmux. Se una sessione ha più finestre (doppioni già esistenti) la mod ne usa una e non ne chiude mai nessuna da sola. Il riferimento PACA è quello trovato nella trascrizione, non una verità: se la chat ha citato un altro task per ultimo, vince quello. Il pannello ne mostra solo 12.
- **PACA e il formato testuale.** L'MCP di PACA risponde con testo formattato, non JSON. I parser leggono i blocchi `Chiave: valore` e sono fragili: se PACA cambia formato, si rompono. I test coprono il formato attuale e sono il primo posto dove accorgersene.
- **Task attivo.** Si aggiorna solo quando la chat chiama `update_task` su un server PACA o quando il polling rilegge i task. Uno spostamento fatto da fuori, a mano o da un'altra chat, compare nei toast ma non lo imposta come attivo.
- **Più chat sullo stesso workspace.** Il lock del polling è best effort (scrittura e rilettura sullo store, non atomico): in una gara rara due sessioni possono fare un giro entrambe, con un toast doppio. Se la sessione che tiene il lock si chiude, i toast riprendono dopo circa 6 minuti.
- **Titolo della finestra tmux.** Si aggiorna a fine turno, non a ogni `/rename`: dopo un rename serve il turno successivo o `/titolo-finestra`. Il riconoscimento di una finestra "nostra" si basa su `automatic-rename`: se l'hai spento per tutto tmux, la mod non rinomina niente finché non usi `/titolo-finestra`. Le chat verticali aperte con `-n` restano col loro slug.
- **Copia hot-reload.** In una sessione che ha caricato anche una copia della mod in hot-reload (per esempio con `--plugin-dir` oltre all'installazione), la banda appare doppia.

## Idee aperte

- Annullare la conferma di `chiudi` anche premendo qualunque altro pulsante (oggi si annulla con il timeout di 5 secondi, `vai` o una ripresa).
