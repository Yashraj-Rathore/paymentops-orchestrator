import { defineStore } from "pinia";

export const useFoundationStore = defineStore("foundation", {
  state: () => ({
    apiStatus: "Ready"
  }),
  actions: {
    refresh() {
      this.apiStatus = "Ready";
    }
  }
});
