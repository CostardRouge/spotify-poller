# Vérifications empiriques — spec §12

À compléter AVANT de construire quoi que ce soit par-dessus le poller.
Chaque test remet en cause une hypothèse de la spec.

## 1. `played_at` = début ou fin de lecture ?

- **Méthode** : jouer un titre à une heure notée précisément ; comparer
  `played_at` et `played_at − duration_ms` avec l'heure de démarrage réelle.
- **Résultat** :
- **Conclusion pour la corrélation fine** :

## 2. Écoute hors-ligne (LE test critique — sorties vélo)

- **Méthode** : mode avion, jouer 3 titres à des heures notées, se reconnecter,
  déclencher `POST /run?collector=A`, observer les `played_at`.
- **Résultat** :
- **Les horodatages reflètent-ils l'écoute réelle ou la synchro ?** :

## 3. Seuil de durée minimale

- **Méthode** : lancer un titre, skipper après ~5 s ; vérifier sa présence
  dans la réponse de l'API.
- **Résultat** :

## 4. Session privée

- **Méthode** : activer la session privée, jouer un titre, vérifier.
- **Résultat** :

## 5. Podcasts

- **Méthode** : jouer un épisode de podcast, vérifier ce qui remonte
  (présence, forme du payload, champ `track` ?).
- **Résultat** :
- **Nécessite un `type` distinct ?** :
