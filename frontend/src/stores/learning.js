import { defineStore } from "pinia";
import { api } from "../api";
export const useLearningStore = defineStore("learning", {
  state: () => ({
    words: [],
    libraries: [],
    selectedLibraryId: null,
    mastered: [],
    wrong: [],
    unitSize: 20,
    lastUnit: 0,
    streak: 0,
    perfectCounts: [],
    loaded: false,
    user: null,
  }),
  getters: {
    isGuest: (s) => s.user?.role === "GUEST",
    wrongWords: (s) =>
      s.wrong.map((id) => s.words.find((w) => w.id === id)).filter(Boolean),
    selectedLibrary: (s) =>
      s.libraries.find((l) => l.id === s.selectedLibraryId),
  },
  actions: {
    async bootstrap() {
      const { data } = await api.get("/auth/me");
      this.user = data.user;
      if (this.user) {
        this.user.name = this.user.username;
        await this.loadLibraries();
      }
      this.loaded = true;
    },
    async enterGuest() {
      this.user = {
        id: null,
        username: "游客",
        name: "游客",
        role: "GUEST",
        score: 0,
      };
      this.mastered = [];
      this.wrong = [];
      this.streak = 0;
      this.lastUnit = 0;
      this.perfectCounts = [];
      await this.loadLibraries();
      this.loaded = true;
    },
    async loadLibraries() {
      const { data } = await api.get(
        this.isGuest ? "/guest/libraries" : "/libraries",
      );
      this.libraries = data.libraries;
      this.selectedLibraryId = Number(
        data.selectedLibraryId || data.libraries[0]?.id,
      );
      if (this.selectedLibraryId) await this.loadLearning();
    },
    async loadLearning() {
      const id = this.selectedLibraryId;
      if (this.isGuest) {
        const { data: words } = await api.get("/guest/words", {
          params: { libraryId: id },
        });
        this.words = words;
        this.mastered = [];
        this.wrong = [];
        this.streak = 0;
        this.lastUnit = 0;
        this.perfectCounts = [];
        return;
      }
      const [{ data: words }, { data: progress }] = await Promise.all([
        api.get("/words", { params: { libraryId: id } }),
        api.get("/progress", { params: { libraryId: id } }),
      ]);
      this.words = words;
      if (this.selectedLibrary?.libraryType === "USER")
        this.words = words.map((item) => ({
          ...item,
          audioUrl:
            item.audioUrl ||
            `/audio/words/${encodeURIComponent(item.word.toLowerCase())}.mp3`,
        }));
      Object.assign(this, progress);
    },
    async selectLibrary(id) {
      this.selectedLibraryId = Number(id);
      if (!this.isGuest)
        await api.post("/libraries/select", {
          libraryId: this.selectedLibraryId,
        });
      await this.loadLearning();
    },
    async save() {
      if (!this.user || this.isGuest || !this.selectedLibraryId) return;
      await api.put("/progress", {
        libraryId: this.selectedLibraryId,
        mastered: this.mastered,
        wrong: this.wrong,
        unitSize: this.unitSize,
        lastUnit: this.lastUnit,
        streak: this.streak,
      });
    },
    async mark(
      wordId,
      correct,
      mode,
      unitIndex,
      answer = "",
      removeWrong = false,
    ) {
      this.mastered = correct
        ? [...new Set([...this.mastered, wordId])]
        : this.mastered.filter((id) => id !== wordId);
      if (!correct) this.wrong = [...new Set([...this.wrong, wordId])];
      else if (removeWrong)
        this.wrong = this.wrong.filter((id) => id !== wordId);
      this.streak = correct ? this.streak + 1 : 0;
      this.lastUnit = unitIndex;
      if (this.isGuest) return;
      await this.save();
      const { data } = await api.post("/attempts", {
        libraryId: this.selectedLibraryId,
        wordId,
        correct,
        mode,
        unitIndex,
        answer,
      });
      if (this.user && data.score !== undefined) this.user.score = data.score;
    },
  },
});
