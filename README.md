# multi-view

Una mod di Claude Code (plugin con hooks module TypeScript) che dà una vista comoda per lavorare con più chat e più agenti insieme. Versione 0.3.0.

Pensata per il terminale, in particolare dentro tmux: una banda sopra il prompt con i dati che servono a colpo d'occhio, un pannello "Agenti" con l'albero degli agenti, le sessioni salvate del workspace e i task PACA, e dei toast quando succede qualcosa mentre guardi altrove.

## Funzioni

### Banda sopra il prompt

Una riga sopra il prompt, con i segmenti separati da `│` attenuato, da sinistra a destra:

- **Limiti di utilizzo**: 5h e settimanale (`sett`) come mini barra a 8 celle (`5h ▰▰▰▰▱▱▱▱ 42% 2h10m`), con percentuale usata e tempo al reset. Barra e percentuale sono verdi, gialle da 80% e rosse da 90%. Il tempo al reset si aggiorna una volta al minuto.
- **Contesto**: `ctx ▰▰▱▱▱▱▱▱ 34%`, la percentuale di finestra di contesto usata dalla chat. Verde sotto il 60%, giallo da 60%, rosso da 80% (60% è la soglia oltre cui conviene passare a una nuova chat). Non compare finché la sessione non ha ricevuto una risposta.
- **Nome della chat**: l'ultima cartella del percorso di lavoro (`chat: homelab`).
- **Task PACA attivo**: il riferimento come etichetta a colori invertiti, poi stato e titolo in blu (` HOME-12 ` `In Progress: titolo`). Vedi la sezione PACA.
- **Conteggio agenti**: `● 2 ◐ 1 / 3`, cioè attivi in verde, idle in giallo, totale attenuato; solo se c'è almeno un agente.
- **Messaggi in arrivo**: `✉ N` in giallo, se l'inbox non è vuota.
- Pulsante **Sessioni**: apre il pannello con l'elenco delle sessioni salvate.
- **Vista agente**: quando stai guardando la trascrizione di un agente compare `vista: <nome>` e il pulsante **Torna**, che riporta alla conversazione principale.

La banda non compare se Claude Code sta mostrando il questionario di feedback.

### Pannello "Agenti"

Si apre da solo all'avvio della sessione (vedi i limiti) e con `/agenti`. Dall'alto:

Il pannello è fatto di sezioni con bordo arrotondato e titolo colorato, solo quelle che hanno contenuto:

1. **Limiti**: 5h e settimanale con una barra più larga della banda (si adatta alla larghezza del pannello, da 8 a 24 celle), la percentuale e sotto il tempo al reset (`reset tra 2h10m`). Stessi colori della banda.
2. **Agenti**: il pulsante **Conversazione principale** (con `▸` quando è la vista corrente) e l'**albero degli agenti**, con i figli sotto al genitore tramite i connettori `├─` e `└─`. Ogni riga ha un glifo di stato e un pulsante: un click apre la trascrizione di quell'agente nella vista principale. A destra stato e tipo. Glifi: `●` verde per running e ciano per pending e waiting, `◐` giallo per idle, `✓` attenuato per completed, `✗` rosso per failed, `■` attenuato per killed.
3. **Sessioni**: la sezione richiudibile con le sessioni del workspace (vedi sotto).
4. **PACA**: visibile solo se il workspace è agganciato a un progetto.
5. **Messaggi**: gli ultimi 5 messaggi dell'inbox, con mittente e testo su una riga, e il pulsante **Svuota inbox**.

### Notifiche (toast)

- **Agente finito**: quando un agente passa da attivo (`pending`, `running`, `waiting`) a terminato (`completed`, `failed`, `killed`, `idle`), per esempio `Agente completed: nome`.
- **Messaggio da un'altra sessione**: `Messaggio da <mittente>`.
- **Soglie dei limiti**: `Limite 5h al 83%` la prima volta che si supera l'80% e di nuovo al 90%. Una soglia già notificata non si ripete finché la finestra non si azzera.
- **Cambi di stato PACA**: `HOME-12: Todo → In Progress` quando un task cambia stato tra due letture; per il task attivo anche `HOME-12 aggiornato su PACA` se cambia solo la data di aggiornamento.
- Errori di servizio: sessioni non leggibili, PACA non raggiungibile, comando non registrato.

### Sessioni salvate del workspace

Claude Code salva ogni sessione in `~/.claude/projects/<cwd>/<sessionId>.jsonl`, dove `<cwd>` è il percorso di lavoro con ogni carattere non alfanumerico sostituito da `-`. La mod lo ricostruisce e lo legge con `hooks/list_sessions.py`, lanciato con `python3 -I`.

Il titolo di ogni sessione viene da, in ordine: l'ultimo `custom-title` (quello di `/rename`), l'ultimo `ai-title`, l'ultimo `last-prompt`, altrimenti `(senza titolo)`; si usa solo la prima riga. L'elenco è ordinato dalla più recente e il pannello ne mostra 12, con quanto tempo fa sono state modificate (`5m fa`, `3h fa`, `2g fa`). Le sessioni sono precedute da `○`, con l'età attenuata a fianco. Se il workspace è agganciato a un progetto PACA, accanto al titolo c'è il task su cui la sessione ha lavorato, come etichetta a colori invertiti (blu se è il task attivo di questa chat): `list_sessions.py` riceve `--prefix <PREFISSO>` e prende l'ultimo riferimento di quel prefisso trovato nei prompt dell'utente e negli input dei tool PACA, Bash e Skill (non nei risultati dei tool, che elencano molti task), così `ADR-010` o `UTF-8` non contano. La sessione corrente appare come `● titolo (questa)` e non è cliccabile.

Click su una sessione: dentro tmux apre una nuova finestra (`tmux new-window`, nella stessa cartella, col titolo come nome) che lancia `claude --resume <id>`. Il nome della finestra finisce con `·` e i primi 8 caratteri dell'id: prima di aprirne una nuova la mod cerca quel suffisso con `tmux list-windows`, e se la sessione è già aperta salta a quella finestra (`Già aperta: salto alla finestra`) invece di duplicarla. Fuori da tmux copia il comando negli appunti e lo segnala con un toast. Una mod non può cambiare la sessione del processo in cui gira, per questo si passa da una nuova finestra.

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
| `/agenti` | Rilegge gli agenti e apre il pannello. |
| `/sessioni` | Apre il pannello con la sezione sessioni espansa e ricaricata. |
| `/paca-tasks` | Apre il pannello con la sezione PACA espansa. Se il workspace non è agganciato, suggerisce `/paca-link`. |
| `/paca-link <PREFISSO> [server MCP]` | Collega il workspace al progetto con quel prefisso (maiuscolo automatico), opzionalmente su un server MCP preciso. Esempio: `/paca-link HOME paca-homelab`. |
| `/paca-link auto` | Cancella il collegamento e torna all'aggancio automatico via remote git. |
| `/paca-link off` | Disattiva PACA per questo workspace. |
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
- `git` (per riconoscere il progetto PACA dal remote `origin`).
- Un server MCP PACA (opzionale: senza, le funzioni PACA restano spente e il resto funziona).

## Sviluppo

Struttura:

```
claude-multi-view/
├── .claude-plugin/
│   ├── plugin.json        # nome, versione, descrizione, percorso dei tipi
│   └── marketplace.json   # marketplace locale gorlix-multi-view, sorgente ./
├── hooks/
│   ├── hooks.json         # dichiara il modulo: ./register.tsx
│   ├── register.tsx       # banda, pannello, comandi, toast, inbox, sessioni
│   ├── ui.ts              # helper grafici puri: barre, glifi di stato, albero, colori, soglie
│   ├── paca.ts            # chiamate all'MCP PACA, parser del testo, aggancio e polling
│   └── list_sessions.py   # legge le sessioni salvate (titolo, task PACA) e stampa JSON
├── types/index.d.ts       # tipi condivisi e stato dichiarato del plugin
├── tests/
│   ├── register.test.ts   # inbox, albero agenti, limiti, sessioni
│   ├── paca.test.ts       # parser PACA, backlog, lock del polling, aggancio, task attivo
│   └── test_list_sessions.py  # ref PACA dalle trascrizioni: `python3 -I tests/test_list_sessions.py`
└── tsconfig.json          # estende .claude-plugin/types/tsconfig.json
```

Comandi:

```
claude plugin validate ~/Documents/Git/claude-multi-view
claude plugin test ~/Documents/Git/claude-multi-view
python3 -I tests/test_list_sessions.py
```

Il type-check si fa con `tsc -p .` (senza emettere file): il `tsconfig.json` estende `.claude-plugin/types/tsconfig.json`, che l'engine scrive (con i tipi dell'API) solo quando carica la cartella in sviluppo, con `claude --plugin-dir .` o in hot reload. La cartella `types/` generata non è versionata.

Vincoli da conoscere, scoperti a proprie spese:

- **Gli atom di `$.state` vanno dichiarati con `atom(...)` nel file che li usa**, altrimenti il validatore protesta. Per questo `pacaProject`, `pacaTasks` e `pacaActive` sono dichiarati due volte, sia in `register.tsx` sia in `paca.ts`, con gli stessi `plugin` e `key`: sono lo stesso stato visto da due file.
- **Le funzioni che ricevono `$` vanno dichiarate a livello top del file**, non dentro altre funzioni.
- **Alza la versione in `plugin.json` a ogni rilascio**, altrimenti resta in uso la copia in cache della versione precedente.

## Limiti noti

- **Limiti di utilizzo.** Si leggono dall'ultima risposta dell'API, quindi mancano finché la sessione non ne ha ricevuta una. I valori sono quelli dell'ultima risposta, non una lettura in tempo reale.
- **Agenti.** Si rileggono ogni 2 secondi; quelli lanciati dai workflow non compaiono.
- **Apertura automatica del pannello.** All'avvio la mod chiede di aprire il pannello, ma è l'engine a decidere se c'è posto: secondo la documentazione delle mod un pannello aperto senza un'azione dell'utente si apre solo da 144 colonne in su. Sotto, si apre con `/agenti` o col pulsante Sessioni.
- **Mittente dei messaggi.** Per i messaggi tra sessioni il mittente è quello che l'engine espone (nome del teammate o del plugin); molto spesso non c'è e compare "altra sessione".
- **Sessioni.** Il controllo "già aperta" riconosce solo le finestre aperte dalla mod (nome col suffisso dell'id): una `claude --resume` lanciata a mano in un'altra finestra non si vede, e se la finestra viene rinominata si può riaprire. Il riferimento PACA è quello trovato nella trascrizione, non una verità: se la chat ha citato un altro task per ultimo, vince quello. Il pannello ne mostra solo 12.
- **PACA e il formato testuale.** L'MCP di PACA risponde con testo formattato, non JSON. I parser leggono i blocchi `Chiave: valore` e sono fragili: se PACA cambia formato, si rompono. I test coprono il formato attuale e sono il primo posto dove accorgersene.
- **Task attivo.** Si aggiorna solo quando la chat chiama `update_task` su un server PACA o quando il polling rilegge i task. Uno spostamento fatto da fuori, a mano o da un'altra chat, compare nei toast ma non lo imposta come attivo.
- **Più chat sullo stesso workspace.** Il lock del polling è best effort (scrittura e rilettura sullo store, non atomico): in una gara rara due sessioni possono fare un giro entrambe, con un toast doppio. Se la sessione che tiene il lock si chiude, i toast riprendono dopo circa 6 minuti.
- **Copia hot-reload.** In una sessione che ha caricato anche una copia della mod in hot-reload (per esempio con `--plugin-dir` oltre all'installazione), la banda appare doppia.

## Idee aperte

- Un pannello delle chat verticali, dentro la mod `chat-verticali` e non qui.
