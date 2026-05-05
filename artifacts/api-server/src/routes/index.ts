import { Router, type IRouter } from "express";
import healthRouter from "./health";
import threadsRouter from "./threads";
import messagesRouter from "./messages";
import settingsRouter from "./settings";
import statsRouter from "./stats";
import importRouter from "./import";

const router: IRouter = Router();

router.use(healthRouter);
router.use(threadsRouter);
router.use(messagesRouter);
router.use(settingsRouter);
router.use(statsRouter);
router.use(importRouter);

export default router;
